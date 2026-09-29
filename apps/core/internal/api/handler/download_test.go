package handler

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type downloadHandlerCapture struct {
	params chan core.DownloadParams
}

func (d *downloadHandlerCapture) Download(_ context.Context, params core.DownloadParams, _ core.Callbacks) (core.DownloadResult, error) {
	d.params <- params
	return core.DownloadResult{PrimaryPath: "/downloads/xiaohongshu.mp4"}, nil
}

func (*downloadHandlerCapture) Config() interface{} { return nil }

func TestDownloadHandlerAutoStartKeepsBrowserCredentialsRuntimeOnly(t *testing.T) {
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	database, err := db.New(filepath.Join(t.TempDir(), "downloads.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	repository := repo.NewVideoRepository(database)
	capture := &downloadHandlerCapture{params: make(chan core.DownloadParams, 1)}
	queue := core.NewTaskQueue(capture, 1)
	downloadSvc := service.NewDownloadTaskService(repository, queue, nil)
	handler := NewDownloadHandler(downloadSvc, newDiscoveryHandlerConfig(), sse.New())
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/downloads", handler.Create)

	response := performDiscoveryRequest(t, router, http.MethodPost, "/api/downloads", map[string]any{
		"startDownload": true,
		"tasks": []map[string]any{{
			"name": "小红书作品",
			"type": "xiaohongshu",
			"url":  "https://www.xiaohongshu.com/explore/abc123?xsec_token=signed-token",
			"headers": strings.Join([]string{
				"Cookie: web_session=sentinel-cookie",
				"Authorization: Bearer sentinel-authorization",
				"Referer: https://www.xiaohongshu.com/",
			}, "\n"),
		}},
	})
	if response.Code != http.StatusOK {
		t.Fatalf("download response = %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "sentinel-") {
		t.Fatalf("download response leaked credentials: %s", response.Body.String())
	}

	select {
	case params := <-capture.params:
		joined := strings.Join(params.Headers, "\n")
		if !strings.Contains(joined, "sentinel-cookie") || !strings.Contains(joined, "sentinel-authorization") {
			t.Fatalf("runtime queue headers = %s", joined)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for download")
	}

	videos, err := repository.FindAll("ASC")
	if err != nil || len(videos) != 1 {
		t.Fatalf("stored downloads = %+v, %v", videos, err)
	}
	if videos[0].Headers == nil || strings.Contains(*videos[0].Headers, "sentinel-") || !strings.Contains(*videos[0].Headers, "Referer") {
		t.Fatalf("persisted headers = %v", videos[0].Headers)
	}
	waitForDownloadHandlerQueue(t, queue)
}

func waitForDownloadHandlerQueue(t *testing.T, queue *core.TaskQueue) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for queue.IsFull() {
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for download queue")
		}
		time.Sleep(time.Millisecond)
	}
}
