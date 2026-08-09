package lineclient

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// mafumafu chat_id: u2d03b563a3d76aea46fae544f09ab79e
// test accu chat_id: u795df6484daed7edc42e873bb6690ac3
const DefaultChatID = "u2d03b563a3d76aea46fae544f09ab79e"

type MessageSource interface {
	LatestMessage(context.Context, string) (Message, error)
}

type MessageSender interface {
	Send(context.Context, Message) error
}

type StateStore interface {
	Load() (int64, error)
	Save(int64) error
}

type Watcher struct {
	Source   MessageSource
	Sender   MessageSender
	State    StateStore
	ChatID   string
	Interval time.Duration
	Logger   *log.Logger
}

type SQLiteSource struct {
	database *sql.DB
}

type FileStateStore struct {
	Path string
}

func OpenSQLiteSource(path string) (*SQLiteSource, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("LINE database path is required")
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve LINE database path: %w", err)
	}
	if _, err := os.Stat(absolutePath); err != nil {
		return nil, fmt.Errorf("access LINE database: %w", err)
	}
	database, err := sql.Open(
		"sqlite3",
		"file:"+filepath.ToSlash(absolutePath)+"?mode=ro&_busy_timeout=5000",
	)
	if err != nil {
		return nil, fmt.Errorf("open LINE database: %w", err)
	}
	if err := database.Ping(); err != nil {
		database.Close()
		return nil, fmt.Errorf("connect to LINE database: %w", err)
	}
	return &SQLiteSource{database: database}, nil
}

func (source *SQLiteSource) LatestMessage(
	ctx context.Context,
	chatID string,
) (Message, error) {
	const query = `
		SELECT last_message, last_created_time
		FROM chat
		WHERE chat_id = ?
		LIMIT 1`
	var message Message
	if err := source.database.QueryRowContext(ctx, query, chatID).Scan(
		&message.Content,
		&message.Time,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Message{}, fmt.Errorf("chat %q was not found", chatID)
		}
		return Message{}, fmt.Errorf("read latest LINE message: %w", err)
	}
	return message, nil
}

func (source *SQLiteSource) Close() error {
	return source.database.Close()
}

func (store FileStateStore) Load() (int64, error) {
	content, err := os.ReadFile(store.Path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read watcher state: %w", err)
	}
	value, err := strconv.ParseInt(strings.TrimSpace(string(content)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse watcher state: %w", err)
	}
	return value, nil
}

func (store FileStateStore) Save(timestamp int64) error {
	directory := filepath.Dir(store.Path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create watcher state directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".last-message-*")
	if err != nil {
		return fmt.Errorf("create temporary watcher state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("set watcher state permissions: %w", err)
	}
	if _, err := fmt.Fprintf(temporary, "%d\n", timestamp); err != nil {
		temporary.Close()
		return fmt.Errorf("write watcher state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync watcher state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close watcher state: %w", err)
	}
	if err := os.Rename(temporaryPath, store.Path); err != nil {
		return fmt.Errorf("replace watcher state: %w", err)
	}
	return nil
}

func (watcher *Watcher) Run(ctx context.Context) error {
	if watcher.Source == nil || watcher.Sender == nil || watcher.State == nil {
		return errors.New("watcher source, sender, and state are required")
	}
	if watcher.ChatID == "" {
		return errors.New("watcher chat ID is required")
	}
	if watcher.Interval <= 0 {
		return errors.New("watcher interval must be positive")
	}
	lastTimestamp, err := watcher.State.Load()
	if err != nil {
		return err
	}
	logger := watcher.Logger
	if logger == nil {
		logger = log.Default()
	}

	poll := func() {
		updatedTimestamp, err := watcher.PollOnce(ctx, lastTimestamp)
		if err != nil {
			logger.Printf("LINE message poll failed: %v", err)
			return
		}
		if updatedTimestamp != lastTimestamp {
			logger.Printf("LINE message sent: timestamp=%d", updatedTimestamp)
			lastTimestamp = updatedTimestamp
		}
	}
	poll()
	ticker := time.NewTicker(watcher.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			poll()
		}
	}
}

func (watcher *Watcher) PollOnce(
	ctx context.Context,
	lastTimestamp int64,
) (int64, error) {
	message, err := watcher.Source.LatestMessage(ctx, watcher.ChatID)
	if err != nil {
		return lastTimestamp, err
	}
	if message.Time <= lastTimestamp {
		return lastTimestamp, nil
	}
	if err := watcher.Sender.Send(ctx, message); err != nil {
		return lastTimestamp, err
	}
	if err := watcher.State.Save(message.Time); err != nil {
		return lastTimestamp, err
	}
	return message.Time, nil
}
