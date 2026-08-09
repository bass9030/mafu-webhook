package lineclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testKeyID = "line-2026-01"

func TestNewRequestMatchesServerSignatureContract(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	client, err := New("https://example.com/api/line-webhook", testKeyID, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	client.Now = func() time.Time { return time.Unix(1_786_284_000, 0) }
	client.Random = bytes.NewReader(bytes.Repeat([]byte{0x42}, 24))
	body := []byte(`{"time":1786284000000,"content":"hello"}`)

	request, err := client.NewRequest(context.Background(), body)
	if err != nil {
		t.Fatal(err)
	}
	if request.Header.Get("Content-Digest") != ContentDigest(body) {
		t.Fatal("content digest does not match body")
	}
	signature, err := base64.StdEncoding.DecodeString(request.Header.Get("X-Signature"))
	if err != nil {
		t.Fatal(err)
	}
	signatureBase := SignatureBase(
		request.Method,
		request.URL.EscapedPath(),
		request.Header.Get("X-Timestamp"),
		request.Header.Get("X-Nonce"),
		request.Header.Get("Content-Digest"),
	)
	if !ed25519.Verify(publicKey, []byte(signatureBase), signature) {
		t.Fatal("signature did not verify")
	}
}

func TestSendPostsSignedMessage(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Error(err)
			response.WriteHeader(http.StatusInternalServerError)
			return
		}
		signature, err := base64.StdEncoding.DecodeString(request.Header.Get("X-Signature"))
		if err != nil {
			t.Error(err)
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		signatureBase := SignatureBase(
			request.Method,
			request.URL.EscapedPath(),
			request.Header.Get("X-Timestamp"),
			request.Header.Get("X-Nonce"),
			request.Header.Get("Content-Digest"),
		)
		if request.Header.Get("X-Key-Id") != testKeyID ||
			request.Header.Get("Content-Digest") != ContentDigest(body) ||
			!ed25519.Verify(publicKey, []byte(signatureBase), signature) {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		var message Message
		if err := json.Unmarshal(body, &message); err != nil {
			t.Error(err)
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		if message.Content != "hello" || message.Time != 1_786_284_000_000 {
			t.Errorf("unexpected message: %+v", message)
		}
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, err := New(server.URL+"/api/line-webhook", testKeyID, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Send(context.Background(), Message{
		Time:    1_786_284_000_000,
		Content: "hello",
	}); err != nil {
		t.Fatal(err)
	}
}

func TestParsePrivateKeySupportsPEMAndBase64DER(t *testing.T) {
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	pemValue := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	for name, value := range map[string]string{
		"PEM":        string(pemValue),
		"base64 DER": base64.StdEncoding.EncodeToString(der),
	} {
		t.Run(name, func(t *testing.T) {
			parsed, err := ParsePrivateKey(value)
			if err != nil {
				t.Fatal(err)
			}
			if !parsed.Equal(privateKey) {
				t.Fatal("parsed key does not match source key")
			}
		})
	}
}
