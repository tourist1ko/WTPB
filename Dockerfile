FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund && npm cache clean --force
COPY frontend ./frontend
RUN npm run build

FROM golang:1.23-alpine AS backend
WORKDIR /app
ENV GOSUMDB=off
COPY go.mod go.sum main.go ./
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /jasaq .

FROM alpine:3.21
WORKDIR /app
COPY --from=backend /jasaq /app/jasaq
COPY web/ /app/web/
COPY --from=frontend /app/web/app.bundle.js /app/web/app.bundle.js
ENV PORT=3000
EXPOSE 3000
CMD ["/app/jasaq"]
