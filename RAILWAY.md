# Запуск JASAQ на Railway

JASAQ — это Discord Activity (приложение в голосовом канале). Отдельный бот-процесс не нужен: один сервер на Railway отдаёт и страницу, и WebSocket.

## 1. Discord Developer Portal
1. https://discord.com/developers/applications → New Application → имя JASAQ.
2. **OAuth2**: скопируйте Client ID и Client Secret (Reset Secret). В Redirects добавьте `https://127.0.0.1` (нужен для авторизации внутри Activity).
3. **Activities → Settings**: включите Enable Activities.
4. **Installation**: включите Guild Install, скопируйте ссылку установки и добавьте приложение на свой сервер.

## 2. Railway
1. Загрузите папку проекта в репозиторий GitHub (без node_modules).
2. https://railway.com → New Project → Deploy from GitHub repo → выберите репозиторий. Railway сам найдёт `Dockerfile`.
3. **Variables** сервиса:
   ```
   DISCORD_CLIENT_ID=<Client ID>
   DISCORD_CLIENT_SECRET=<Client Secret>
   SESSION_SECRET=<любая случайная строка от 32 символов>
   ALLOWED_GUILD_ID=<ID вашего сервера, необязательно>
   ALLOW_DEMO_FALLBACK=false
   ```
   `PORT` задавать не нужно, Railway подставляет его сам.
4. **Settings → Networking → Generate Domain**. Получится адрес вида `jasaq-production.up.railway.app`.
5. Проверка: откройте `https://<домен>/health`, должно быть `JASAQ OK`.

## 3. Связать Discord с Railway
Developer Portal → **Activities → URL Mappings**: Prefix `/`, Target `jasaq-production.up.railway.app` (без https://). Сохранить.

## 4. Запуск
Зайдите в голосовой канал → кнопка Activities (ракета) → JASAQ. Первый, кто открыл, становится лидером.
Пока приложение не прошло проверку Discord, оно может быть видно только вам. Тогда добавьте друзей в Developer Portal → App Testers.

## Обновление
Каждый push в GitHub пересобирает и перезапускает сервис автоматически.

## Чтобы не лагало
- Держите сервис в регионе, ближайшем к игрокам (Settings → Region; для Казахстана и СНГ ближе всего Europe).
- Не включайте Sleep / Serverless для сервиса: после «сна» первое подключение будет медленным.
- Картинки карт кешируются на сервере после первого показа. Чтобы не зависеть от вики, положите их в `web/maps/`.
