package lineclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxErrorResponseBytes = 4 << 10

type Message struct {
	Time    int64  `json:"time"`
	Content string `json:"content"`
}

type Client struct {
	Endpoint   *url.URL
	KeyID      string
	PrivateKey ed25519.PrivateKey
	HTTPClient *http.Client
	Now        func() time.Time
	Random     io.Reader
}

func New(endpoint, keyID string, privateKey ed25519.PrivateKey) (*Client, error) {
	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse endpoint: %w", err)
	}
	if parsedEndpoint.Scheme != "http" && parsedEndpoint.Scheme != "https" {
		return nil, errors.New("endpoint scheme must be http or https")
	}
	if parsedEndpoint.Host == "" || parsedEndpoint.Path == "" {
		return nil, errors.New("endpoint must include a host and path")
	}
	if parsedEndpoint.RawQuery != "" || parsedEndpoint.Fragment != "" {
		return nil, errors.New("endpoint query and fragment are not supported")
	}
	if keyID == "" {
		return nil, errors.New("key ID is required")
	}
	if len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid Ed25519 private key")
	}
	return &Client{
		Endpoint:   parsedEndpoint,
		KeyID:      keyID,
		PrivateKey: privateKey,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
		Now:        time.Now,
		Random:     rand.Reader,
	}, nil
}

func (client *Client) Send(ctx context.Context, message Message) error {
	if message.Content == "" {
		return errors.New("message content is required")
	}
	body, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("marshal message: %w", err)
	}
	request, err := client.NewRequest(ctx, body)
	if err != nil {
		return err
	}
	response, err := client.HTTPClient.Do(request)
	if err != nil {
		return fmt.Errorf("send LINE webhook: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		responseBody, _ := io.ReadAll(io.LimitReader(response.Body, maxErrorResponseBytes))
		return fmt.Errorf(
			"LINE webhook returned %s: %s",
			response.Status,
			strings.TrimSpace(string(responseBody)),
		)
	}
	return nil
}

func (client *Client) NewRequest(ctx context.Context, body []byte) (*http.Request, error) {
	timestamp := fmt.Sprintf("%d", client.Now().Unix())
	nonceBytes := make([]byte, 24)
	if _, err := io.ReadFull(client.Random, nonceBytes); err != nil {
		return nil, fmt.Errorf("generate nonce: %w", err)
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	contentDigest := ContentDigest(body)
	signatureBase := SignatureBase(
		http.MethodPost,
		client.Endpoint.EscapedPath(),
		timestamp,
		nonce,
		contentDigest,
	)
	signature := ed25519.Sign(client.PrivateKey, []byte(signatureBase))

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		client.Endpoint.String(),
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Content-Digest", contentDigest)
	request.Header.Set("X-Key-Id", client.KeyID)
	request.Header.Set("X-Timestamp", timestamp)
	request.Header.Set("X-Nonce", nonce)
	request.Header.Set("X-Signature", base64.StdEncoding.EncodeToString(signature))
	return request, nil
}

func ContentDigest(body []byte) string {
	digest := sha256.Sum256(body)
	return "sha-256=:" + base64.StdEncoding.EncodeToString(digest[:]) + ":"
}

func SignatureBase(method, path, timestamp, nonce, contentDigest string) string {
	return strings.Join([]string{
		"@method:" + strings.ToUpper(method),
		"@path:" + path,
		"x-timestamp:" + timestamp,
		"x-nonce:" + nonce,
		"content-digest:" + contentDigest,
	}, "\n")
}

func ParsePrivateKey(value string) (ed25519.PrivateKey, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, `\n`, "\n"))
	der := []byte(nil)
	if block, _ := pem.Decode([]byte(value)); block != nil {
		der = block.Bytes
	} else {
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil {
			return nil, errors.New("private key must be PKCS#8 PEM or base64 DER")
		}
		der = decoded
	}
	parsed, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		return nil, fmt.Errorf("parse PKCS#8 private key: %w", err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not Ed25519")
	}
	return privateKey, nil
}
