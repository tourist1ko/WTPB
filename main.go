package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
}

type Settings struct {
	Teams     bool     `json:"teams"`
	Mode      bool     `json:"mode"`
	BR        bool     `json:"br"`
	AllowedBR []string `json:"allowed_br"`
	Squads    int      `json:"squads"`
	Maps      []string `json:"maps"`
}

type MatchPlan struct {
	ID       string     `json:"id"`
	TeamA    []Player   `json:"team_a,omitempty"`
	TeamB    []Player   `json:"team_b,omitempty"`
	Squads   [][]Player `json:"squads,omitempty"`
	Mode     string     `json:"mode,omitempty"`
	Map      string     `json:"map,omitempty"`
	BR       string     `json:"br,omitempty"`
	UseTeams bool       `json:"use_teams"`
	UseMode  bool       `json:"use_mode"`
	UseBR    bool       `json:"use_br"`
}

type Client struct {
	conn   *websocket.Conn
	player Player
	room   *Room
	write  sync.Mutex
}

type Room struct {
	mu       sync.Mutex
	clients  map[string]*Client
	leaderID string
	players  []Player // active participants = voice minus excluded
	voice    []Player // full voice-channel roster pushed by the leader
	excluded map[string]bool
	settings Settings
	busy     bool
	match    *MatchPlan
	epoch    uint64
}

type Message struct {
	Type     string     `json:"type"`
	Players  []Player   `json:"players,omitempty"`
	Reserve  []Player   `json:"reserve,omitempty"`
	Online   []Player   `json:"online,omitempty"`
	LeaderID string     `json:"leader_id,omitempty"`
	Busy     bool       `json:"busy,omitempty"`
	Settings *Settings  `json:"settings,omitempty"`
	Match    *MatchPlan `json:"match,omitempty"`
	At       int64      `json:"at,omitempty"`
	ClientAt int64      `json:"client_at,omitempty"`
	ServerAt int64      `json:"server_at,omitempty"`
	Error    string     `json:"error,omitempty"`
}

type Ticket struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar,omitempty"`
	Guild  string `json:"guild"`
	Room   string `json:"room"`
	Exp    int64  `json:"exp"`
}

var allBR = []string{"1.0", "1.3", "1.7", "2.0", "2.3", "2.7", "3.0", "3.3", "3.7", "4.0", "4.3", "4.7", "5.0", "5.3", "5.7", "6.0", "6.3", "6.7", "7.0", "7.3", "7.7", "8.0", "8.3", "8.7", "9.0", "9.3", "9.7", "10.0", "10.3", "10.7", "11.0", "11.3", "11.7", "12.0", "12.3", "12.7", "13.0", "13.3", "13.7", "14.0"}

func validMaps(values []string) []string {
	known := map[string]bool{}
	for _, v := range allMaps {
		known[v] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if known[v] && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		out = append(out, allMaps...)
	}
	return out
}

var rooms = struct {
	sync.Mutex
	m map[string]*Room
}{m: map[string]*Room{}}

var secret []byte
var httpClient = &http.Client{Timeout: 12 * time.Second}

func random(n int) int {
	if n <= 1 {
		return 0
	}
	x, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err)
	}
	return int(x.Int64())
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func defaultSettings() Settings {
	return Settings{Teams: true, Mode: true, Maps: append([]string(nil), allMaps...), BR: true, AllowedBR: append([]string(nil), allBR...), Squads: 2}
}

func jsonOut(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func errOut(w http.ResponseWriter, status int, msg string) {
	jsonOut(w, status, map[string]string{"error": msg})
}

func ticketSign(t Ticket) string {
	b, _ := json.Marshal(t)
	payload := base64.RawURLEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func ticketVerify(value string) (Ticket, error) {
	var t Ticket
	parts := strings.Split(value, ".")
	if len(parts) != 2 {
		return t, errors.New("bad ticket")
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0]))
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(mac.Sum(nil), sig) {
		return t, errors.New("invalid signature")
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(b, &t) != nil || t.Exp < time.Now().Unix() || t.ID == "" || t.Room == "" {
		return t, errors.New("expired ticket")
	}
	return t, nil
}

func (c *Client) send(m Message) error {
	c.write.Lock()
	defer c.write.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(4 * time.Second))
	return c.conn.WriteJSON(m)
}

func (r *Room) snapshotLocked() Message {
	players := append([]Player(nil), r.players...)
	reserve := []Player{}
	for _, p := range r.voice {
		if r.excluded[p.ID] {
			reserve = append(reserve, p)
		}
	}
	online := make([]Player, 0, len(r.clients))
	for _, c := range r.clients {
		online = append(online, c.player)
	}
	sort.Slice(online, func(i, j int) bool { return online[i].ID < online[j].ID })
	return Message{Type: "state", Players: players, Reserve: reserve, Online: online, LeaderID: r.leaderID, Busy: r.busy, Settings: &r.settings, Match: r.match}
}
func (r *Room) snapshot() Message { r.mu.Lock(); defer r.mu.Unlock(); return r.snapshotLocked() }
func (r *Room) broadcast(m Message) {
	r.mu.Lock()
	clients := make([]*Client, 0, len(r.clients))
	for _, c := range r.clients {
		clients = append(clients, c)
	}
	r.mu.Unlock()
	// send in parallel so one slow connection never delays the others
	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Add(1)
		go func(c *Client) {
			defer wg.Done()
			if c.send(m) != nil {
				_ = c.conn.Close()
			}
		}(c)
	}
	wg.Wait()
}
func (r *Room) update() { r.broadcast(r.snapshot()) }

func sanitizePlayers(in []Player) []Player {
	seen := map[string]bool{}
	out := make([]Player, 0, len(in))
	for _, p := range in {
		p.ID = strings.TrimSpace(p.ID)
		p.Name = strings.TrimSpace(p.Name)
		if p.ID == "" || p.Name == "" || seen[p.ID] {
			continue
		}
		if len([]rune(p.Name)) > 40 {
			p.Name = string([]rune(p.Name)[:40])
		}
		seen[p.ID] = true
		out = append(out, p)
		if len(out) >= 40 {
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func validAllowed(values []string) []string {
	allowedSet := map[string]bool{}
	for _, v := range allBR {
		allowedSet[v] = true
	}
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if allowedSet[v] && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		out = []string{"7.0"}
	}
	return out
}

func (r *Room) recomputePlayersLocked() {
	out := make([]Player, 0, len(r.voice))
	for _, p := range r.voice {
		if !r.excluded[p.ID] {
			out = append(out, p)
		}
	}
	r.players = out
}

func samePlayers(a, b []Player) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func clampSquads(n int) int {
	if n < 2 {
		return 2
	}
	if n > 4 {
		return 4
	}
	return n
}

func (r *Room) makePlan() (*MatchPlan, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.busy {
		return nil, errors.New("busy")
	}
	if len(r.players) < 2 {
		return nil, errors.New("players")
	}
	players := append([]Player(nil), r.players...)
	s := r.settings
	plan := &MatchPlan{ID: newID(), UseTeams: s.Teams, UseMode: s.Mode, UseBR: s.BR}
	if s.Teams {
		for i := len(players) - 1; i > 0; i-- {
			j := random(i + 1)
			players[i], players[j] = players[j], players[i]
		}
		n := clampSquads(s.Squads)
		if n > len(players) {
			n = len(players)
		}
		plan.Squads = make([][]Player, n)
		for i, p := range players {
			plan.Squads[i%n] = append(plan.Squads[i%n], p)
		}
		plan.TeamA = plan.Squads[0]
		if n > 1 {
			plan.TeamB = plan.Squads[1]
		}
	}
	if s.Mode {
		pool := validMaps(s.Maps)
		plan.Map = pool[random(len(pool))]
	}
	if s.BR {
		pool := validAllowed(s.AllowedBR)
		plan.BR = pool[random(len(pool))]
	}
	r.busy = true
	r.match = plan
	r.epoch++
	return plan, nil
}

func (r *Room) finishMatch(matchID string) {
	r.mu.Lock()
	if r.match != nil && r.match.ID == matchID {
		r.busy = false
	}
	r.mu.Unlock()
	r.update()
}
func (r *Room) skipMatch(matchID string) {
	r.mu.Lock()
	if r.match == nil || r.match.ID != matchID {
		r.mu.Unlock()
		return
	}
	r.busy = false
	r.mu.Unlock()
	r.broadcast(Message{Type: "skip", Match: r.match})
	r.update()
}

func getRoom(id string) *Room {
	rooms.Lock()
	defer rooms.Unlock()
	if rooms.m[id] == nil {
		rooms.m[id] = &Room{clients: map[string]*Client{}, excluded: map[string]bool{}, settings: defaultSettings()}
	}
	return rooms.m[id]
}

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

func ws(w http.ResponseWriter, r *http.Request) {
	t, err := ticketVerify(r.URL.Query().Get("ticket"))
	if err != nil {
		http.Error(w, "Unauthorized", 401)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	room := getRoom(t.Room)
	client := &Client{conn: conn, room: room, player: Player{ID: t.ID, Name: t.Name, Avatar: t.Avatar}}
	room.mu.Lock()
	old := room.clients[t.ID]
	room.clients[t.ID] = client
	if room.leaderID == "" {
		room.leaderID = t.ID
	}
	room.mu.Unlock()
	if old != nil {
		_ = old.conn.Close()
	}
	room.update()
	defer func() {
		room.mu.Lock()
		if room.clients[t.ID] == client {
			delete(room.clients, t.ID)
		}
		if room.leaderID == t.ID {
			room.leaderID = ""
			ids := make([]string, 0, len(room.clients))
			for id := range room.clients {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			if len(ids) > 0 {
				room.leaderID = ids[0]
			}
		}
		empty := len(room.clients) == 0
		room.mu.Unlock()
		_ = conn.Close()
		if empty {
			rooms.Lock()
			if rooms.m[t.Room] == room {
				delete(rooms.m, t.Room)
			}
			rooms.Unlock()
		} else {
			room.update()
		}
	}()
	conn.SetReadLimit(64 << 10)
	for {
		var msg struct {
			Type     string    `json:"type"`
			Players  []Player  `json:"players"`
			Settings *Settings `json:"settings"`
			MatchID  string    `json:"match_id"`
			TargetID string    `json:"target_id"`
			ClientAt int64     `json:"client_at"`
		}
		if conn.ReadJSON(&msg) != nil {
			return
		}
		room.mu.Lock()
		leader := room.leaderID == t.ID
		busy := room.busy
		room.mu.Unlock()
		switch msg.Type {
		case "time_sync":
			_ = client.send(Message{Type: "time_sync", ClientAt: msg.ClientAt, ServerAt: time.Now().UnixMilli()})
		case "roster":
			if !leader {
				continue
			}
			next := sanitizePlayers(msg.Players)
			room.mu.Lock()
			changed := !samePlayers(room.voice, next)
			if changed {
				room.voice = next
				room.recomputePlayersLocked()
			}
			room.mu.Unlock()
			if changed { // roster arrives every few seconds; only broadcast real changes
				room.update()
			}
		case "transfer":
			if !leader || busy || msg.TargetID == "" || msg.TargetID == t.ID {
				continue
			}
			room.mu.Lock()
			_, online := room.clients[msg.TargetID]
			if online {
				room.leaderID = msg.TargetID
			}
			room.mu.Unlock()
			if !online {
				_ = client.send(Message{Type: "error", Error: "offline"})
				continue
			}
			room.update()
		case "exclude", "include":
			if !leader || busy || msg.TargetID == "" {
				continue
			}
			room.mu.Lock()
			if msg.Type == "exclude" {
				room.excluded[msg.TargetID] = true
			} else {
				delete(room.excluded, msg.TargetID)
			}
			room.recomputePlayersLocked()
			room.mu.Unlock()
			room.update()
		case "settings":
			if !leader || busy || msg.Settings == nil {
				continue
			}
			s := *msg.Settings
			s.AllowedBR = validAllowed(s.AllowedBR)
			s.Squads = clampSquads(s.Squads)
			s.Maps = validMaps(s.Maps)
			room.mu.Lock()
			room.settings = s
			room.mu.Unlock()
			room.update()
		case "start":
			if !leader {
				continue
			}
			plan, err := room.makePlan()
			if err != nil {
				client.send(Message{Type: "error", Error: err.Error()})
				continue
			}
			at := time.Now().Add(2500 * time.Millisecond).UnixMilli()
			room.broadcast(Message{Type: "match_start", Match: plan, Busy: true, At: at})
			room.update()
			epoch := plan.ID
			time.AfterFunc(35*time.Second, func() { room.finishMatch(epoch) })
		case "skip":
			room.skipMatch(msg.MatchID)
		case "finish":
			if leader {
				room.finishMatch(msg.MatchID)
			}
		}
	}
}

func auth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errOut(w, 405, "method not allowed")
		return
	}
	var input struct{ Code, Room, Guild string }
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || input.Code == "" || input.Room == "" {
		errOut(w, 400, "invalid request")
		return
	}
	clientID, clientSecret := os.Getenv("DISCORD_CLIENT_ID"), os.Getenv("DISCORD_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		errOut(w, 503, "Discord credentials missing")
		return
	}
	allowedGuild := os.Getenv("ALLOWED_GUILD_ID")
	if allowedGuild != "" && input.Guild != allowedGuild {
		errOut(w, 403, "Бұл серверге рұқсат жоқ")
		return
	}
	form := url.Values{"client_id": {clientID}, "client_secret": {clientSecret}, "grant_type": {"authorization_code"}, "code": {input.Code}}
	req, _ := http.NewRequestWithContext(r.Context(), "POST", "https://discord.com/api/v10/oauth2/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpClient.Do(req)
	if err != nil {
		errOut(w, 502, "Discord token exchange unavailable")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16384))
	if resp.StatusCode != 200 {
		var oauthErr struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		_ = json.Unmarshal(body, &oauthErr)
		log.Printf("Discord OAuth exchange failed: status=%d error=%q description=%q", resp.StatusCode, oauthErr.Error, oauthErr.Description)
		msg := "Discord authorization rejected"
		if oauthErr.Error != "" {
			msg += ": " + oauthErr.Error
		}
		errOut(w, 401, msg)
		return
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if json.Unmarshal(body, &token) != nil || token.AccessToken == "" {
		errOut(w, 502, "invalid token response")
		return
	}
	meReq, _ := http.NewRequestWithContext(r.Context(), "GET", "https://discord.com/api/v10/users/@me", nil)
	meReq.Header.Set("Authorization", "Bearer "+token.AccessToken)
	meResp, err := httpClient.Do(meReq)
	if err != nil {
		errOut(w, 502, "Discord user unavailable")
		return
	}
	defer meResp.Body.Close()
	if meResp.StatusCode != 200 {
		errOut(w, 401, "Discord user rejected")
		return
	}
	var user struct {
		ID         string `json:"id"`
		Username   string `json:"username"`
		GlobalName string `json:"global_name"`
		Avatar     string `json:"avatar"`
	}
	if json.NewDecoder(io.LimitReader(meResp.Body, 16384)).Decode(&user) != nil || user.ID == "" {
		errOut(w, 502, "invalid Discord user")
		return
	}
	name := user.GlobalName
	if name == "" {
		name = user.Username
	}
	avatar := ""
	if user.Avatar != "" {
		avatar = fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png?size=128", user.ID, user.Avatar)
	}
	tk := ticketSign(Ticket{ID: user.ID, Name: name, Avatar: avatar, Guild: input.Guild, Room: input.Room, Exp: time.Now().Add(12 * time.Hour).Unix()})
	jsonOut(w, 200, map[string]string{"access_token": token.AccessToken, "ticket": tk, "name": name, "avatar": avatar, "id": user.ID})
}

func demo(w http.ResponseWriter, r *http.Request) {
	if os.Getenv("ENABLE_DEMO") != "true" && os.Getenv("ALLOW_DEMO_FALLBACK") != "true" {
		http.NotFound(w, r)
		return
	}
	var input struct{ Name, Room, ID string }
	if json.NewDecoder(r.Body).Decode(&input) != nil {
		errOut(w, 400, "bad request")
		return
	}
	if input.Name == "" {
		input.Name = "tourist__"
	}
	if input.Room == "" {
		input.Room = "showcase"
	}
	if input.ID == "" {
		input.ID = newID()
	}
	tk := ticketSign(Ticket{ID: "demo:" + input.ID, Name: input.Name, Room: "demo:" + input.Room, Exp: time.Now().Add(12 * time.Hour).Unix()})
	jsonOut(w, 200, map[string]string{"ticket": tk, "id": "demo:" + input.ID, "name": input.Name})
}

func main() {
	secret = []byte(os.Getenv("SESSION_SECRET"))
	if len(secret) < 32 {
		secret = make([]byte, 32)
		_, _ = rand.Read(secret)
		log.Println("SESSION_SECRET missing: temporary key generated")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "JASAQ OK") })
	cfg := func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, 200, map[string]any{"clientId": os.Getenv("DISCORD_CLIENT_ID"), "allowedGuildId": os.Getenv("ALLOWED_GUILD_ID"), "demo": os.Getenv("ENABLE_DEMO") == "true" || os.Getenv("ALLOW_DEMO_FALLBACK") == "true", "allBR": allBR, "allMaps": allMaps, "maps": mapCatalog})
	}
	mux.HandleFunc("/api/config", cfg)
	mux.HandleFunc("/.proxy/api/config", cfg)
	mux.HandleFunc("/api/auth", auth)
	mux.HandleFunc("/.proxy/api/auth", auth)
	mux.HandleFunc("/api/demo", demo)
	mux.HandleFunc("/ws", ws)
	mux.HandleFunc("/.proxy/ws", ws)
	mux.HandleFunc("/terms", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "./web/terms.html") })
	mux.HandleFunc("/privacy", func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, "./web/privacy.html") })
	mux.HandleFunc("/mapimg/", mapImage)
	mux.HandleFunc("/.proxy/mapimg/", mapImage)
	mux.HandleFunc("/.proxy/api/demo", demo)
	mux.Handle("/", staticHandler("./web"))
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	srv := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 8 * time.Second}
	go func() {
		time.Sleep(time.Second)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:"+port+"/health", nil)
		if resp, err := httpClient.Do(req); err == nil {
			resp.Body.Close()
			log.Printf("SELF-TEST STATUS: %d", resp.StatusCode)
		}
	}()
	log.Printf("JASAQ v8.5 listening on :%s", port)
	log.Fatal(srv.ListenAndServe())
}
