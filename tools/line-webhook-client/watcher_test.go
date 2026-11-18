package lineclient

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

type fakeSource struct {
	message Message
	err     error
}

func (source fakeSource) LatestMessage(context.Context, string) (Message, error) {
	return source.message, source.err
}

type fakeSender struct {
	messages []Message
	err      error
}

func (sender *fakeSender) Send(_ context.Context, message Message) error {
	if sender.err != nil {
		return sender.err
	}
	sender.messages = append(sender.messages, message)
	return nil
}

type memoryState struct {
	value int64
}

func (state *memoryState) Load() (int64, error) { return state.value, nil }
func (state *memoryState) Save(value int64) error {
	state.value = value
	return nil
}

func TestPollOnceSendsOnlyNewMessages(t *testing.T) {
	sender := &fakeSender{}
	state := &memoryState{}
	watcher := &Watcher{
		Source: fakeSource{message: Message{Time: 200, Content: "new"}},
		Sender: sender,
		State:  state,
		ChatID: DefaultChatID,
	}
	updated, err := watcher.PollOnce(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if updated != 200 || state.value != 200 || len(sender.messages) != 1 {
		t.Fatalf("new message was not delivered correctly: updated=%d state=%d sent=%d", updated, state.value, len(sender.messages))
	}
	updated, err = watcher.PollOnce(context.Background(), updated)
	if err != nil {
		t.Fatal(err)
	}
	if updated != 200 || len(sender.messages) != 1 {
		t.Fatal("same message was delivered more than once")
	}
}

func TestPollOnceDoesNotAdvanceStateWhenDeliveryFails(t *testing.T) {
	state := &memoryState{value: 100}
	watcher := &Watcher{
		Source: fakeSource{message: Message{Time: 200, Content: "new"}},
		Sender: &fakeSender{err: errors.New("delivery failed")},
		State:  state,
		ChatID: DefaultChatID,
	}
	updated, err := watcher.PollOnce(context.Background(), 100)
	if err == nil {
		t.Fatal("expected delivery error")
	}
	if updated != 100 || state.value != 100 {
		t.Fatal("state advanced after failed delivery")
	}
}

func TestFileStateStoreRoundTrip(t *testing.T) {
	store := FileStateStore{Path: filepath.Join(t.TempDir(), "nested", "state")}
	value, err := store.Load()
	if err != nil || value != 0 {
		t.Fatalf("new state should start at zero: value=%d err=%v", value, err)
	}
	if err := store.Save(1_786_284_000_000); err != nil {
		t.Fatal(err)
	}
	value, err = store.Load()
	if err != nil || value != 1_786_284_000_000 {
		t.Fatalf("state round trip failed: value=%d err=%v", value, err)
	}
}

func TestSQLiteSourceReadsLatestChatMessage(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "line.db")
	database, err := sql.Open("sqlite3", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec(`
		CREATE TABLE chat (
			chat_id TEXT PRIMARY KEY,
			last_message TEXT NOT NULL,
			last_created_time INTEGER NOT NULL
		);
		INSERT INTO chat (chat_id, last_message, last_created_time)
		VALUES (?, ?, ?);`, DefaultChatID, "detected message", 1_786_284_000_000)
	if err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	source, err := OpenSQLiteSource(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	message, err := source.LatestMessage(context.Background(), DefaultChatID)
	if err != nil {
		t.Fatal(err)
	}
	if message.Content != "detected message" || message.Time != 1_786_284_000_000 {
		t.Fatalf("unexpected message: %+v", message)
	}
}
