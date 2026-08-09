package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	lineclient "github.com/bass9030/mafu-webhook/tools/line-webhook-client"
)

func main() {
	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get working directory: %w", err)
	}
	endpoint := flag.String("url", webhookURL(), "LINE webhook endpoint")
	keyID := flag.String("key-id", envOrDefault("LINE_SIGNING_KEY_ID", "line-2026-01"), "signing key ID")
	privateKeyFile := flag.String("private-key-file", "", "PKCS#8 PEM private key file")
	content := flag.String("content", "", "LINE message content; stdin is used when omitted")
	messageTime := flag.Int64("time", 0, "message timestamp in Unix milliseconds; current time is used when omitted")
	databasePath := flag.String("db", os.Getenv("LINE_DB_PATH"), "LINE SQLite database path; enables watch mode")
	chatID := flag.String("chat-id", envOrDefault("LINE_CHAT_ID", lineclient.DefaultChatID), "LINE chat ID to watch")
	stateFile := flag.String("state-file", envOrDefault("MAHOOK_LINE_STATE_FILE", filepath.Join(workingDirectory, ".mahook-line", "last_sent_message")), "last sent message state file")
	interval := flag.Duration("interval", 5*time.Second, "database polling interval")
	flag.Parse()

	privateKeyValue, err := loadPrivateKey(*privateKeyFile)
	if err != nil {
		return err
	}
	privateKey, err := lineclient.ParsePrivateKey(privateKeyValue)
	if err != nil {
		return err
	}
	client, err := lineclient.New(*endpoint, *keyID, privateKey)
	if err != nil {
		return err
	}
	if *databasePath != "" {
		source, err := lineclient.OpenSQLiteSource(*databasePath)
		if err != nil {
			return err
		}
		defer source.Close()
		fmt.Printf("Watching LINE database %s (chat_id=%s)\n", *databasePath, *chatID)
		return (&lineclient.Watcher{
			Source:   source,
			Sender:   client,
			State:    lineclient.FileStateStore{Path: *stateFile},
			ChatID:   *chatID,
			Interval: *interval,
		}).Run(ctx)
	}

	messageContent, err := readMessageContent(*content)
	if err != nil {
		return err
	}
	if *messageTime == 0 {
		*messageTime = time.Now().UnixMilli()
	}
	if err := client.Send(ctx, lineclient.Message{
		Time:    *messageTime,
		Content: messageContent,
	}); err != nil {
		return err
	}
	fmt.Println("LINE webhook sent successfully")
	return nil
}

func readMessageContent(value string) (string, error) {
	if value == "" {
		stdin, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("read content from stdin: %w", err)
		}
		value = string(stdin)
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("message content is required")
	}
	return value, nil
}

func loadPrivateKey(filename string) (string, error) {
	if filename != "" {
		content, err := os.ReadFile(filename)
		if err != nil {
			return "", fmt.Errorf("read private key: %w", err)
		}
		return string(content), nil
	}
	value := os.Getenv("LINE_SIGNING_PRIVATE_KEY")
	if value == "" {
		return "", errors.New("LINE_SIGNING_PRIVATE_KEY or -private-key-file is required")
	}
	return value, nil
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func webhookURL() string {
	if value := os.Getenv("MAHOOK_LINE_WEBHOOK_URL"); value != "" {
		return value
	}
	return envOrDefault(
		"MAHOOK_API_URL",
		"http://localhost:3000/api/line-webhook",
	)
}
