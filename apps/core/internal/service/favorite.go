package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
)

// ErrURLAlreadyExists is returned when attempting to add a duplicate favorite URL.
var ErrURLAlreadyExists = errors.New("url_already_exists")

// ErrFavoriteNotFound is returned when a favorite ID does not exist.
var ErrFavoriteNotFound = errors.New("favorite_not_found")

// FavoriteService is the business logic layer for favorites.
type FavoriteService struct {
	repo         *repo.FavoriteRepository
	iconResolver FavoriteIconResolver
}

// NewFavoriteService creates a FavoriteService.
func NewFavoriteService(repo *repo.FavoriteRepository) *FavoriteService {
	return NewFavoriteServiceWithIconResolver(repo, NewFaviconResolver(FaviconResolverOptions{}))
}

// NewFavoriteServiceWithIconResolver creates a FavoriteService with an
// injectable resolver for deterministic tests.
func NewFavoriteServiceWithIconResolver(repo *repo.FavoriteRepository, iconResolver FavoriteIconResolver) *FavoriteService {
	return &FavoriteService{repo: repo, iconResolver: iconResolver}
}

// AddFavoriteInput holds the input for adding a favorite.
type AddFavoriteInput struct {
	Title  string  `json:"title"`
	URL    string  `json:"url"`
	Icon   *string `json:"icon"`
	Folder *string `json:"folder"`
}

// GetFavorites retrieves all favorites (sorted by creation time descending).
func (s *FavoriteService) GetFavorites() ([]*db.Favorite, error) {
	return s.repo.FindAll("DESC")
}

// AddFavorite adds a favorite (with URL uniqueness check).
func (s *FavoriteService) AddFavorite(input *AddFavoriteInput) (*db.Favorite, error) {
	existing, err := s.repo.FindByURL(input.URL)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrURLAlreadyExists
	}

	fav := &db.Favorite{
		Title:      input.Title,
		URL:        input.URL,
		Icon:       input.Icon,
		IconStatus: initialFavoriteIconStatus(input.Icon),
		Folder:     normalizeFolder(input.Folder),
	}
	return s.repo.Create(fav)
}

// UpdateFavoriteInput holds the optional fields for updating a favorite.
type UpdateFavoriteInput struct {
	Title  *string
	Folder *string
}

// UpdateFavorite changes the title and/or folder of an existing favorite.
func (s *FavoriteService) UpdateFavorite(id int64, input *UpdateFavoriteInput) (*db.Favorite, error) {
	favorite, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	if favorite == nil {
		return nil, ErrFavoriteNotFound
	}

	updates := map[string]any{}
	if input.Title != nil {
		if title := strings.TrimSpace(*input.Title); title != "" {
			updates["title"] = title
		}
	}
	if input.Folder != nil {
		if folder := normalizeFolder(input.Folder); folder != nil {
			updates["folder"] = *folder
		} else {
			updates["folder"] = nil
		}
	}
	if len(updates) == 0 {
		return favorite, nil
	}

	if err := s.repo.Update(id, updates); err != nil {
		return nil, err
	}
	return s.repo.FindByID(id)
}

// normalizeFolder trims a folder label and collapses empty/blank to nil so an
// entry is treated as ungrouped rather than stored with an empty-string folder.
func normalizeFolder(folder *string) *string {
	if folder == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*folder)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// ResolveFavoriteIcon resolves and persists an eligible favorite's icon using
// the URL already stored for that favorite.
func (s *FavoriteService) ResolveFavoriteIcon(ctx context.Context, id int64) (*db.Favorite, error) {
	favorite, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	if favorite == nil {
		return nil, ErrFavoriteNotFound
	}

	if favorite.Icon != nil && strings.TrimSpace(*favorite.Icon) != "" {
		if favorite.IconStatus != db.FavoriteIconStatusReady {
			favorite.IconStatus = db.FavoriteIconStatusReady
			if err := s.repo.UpdateIcon(favorite.ID, favorite.Icon, favorite.IconStatus); err != nil {
				return nil, err
			}
		}
		return favorite, nil
	}
	if favorite.IconStatus == db.FavoriteIconStatusMissing {
		return favorite, nil
	}

	result := s.iconResolver.Resolve(ctx, favorite.URL)
	var icon *string
	if result.Status == db.FavoriteIconStatusReady && strings.TrimSpace(result.Icon) != "" {
		value := result.Icon
		icon = &value
	} else if result.Status == db.FavoriteIconStatusReady {
		result.Status = db.FavoriteIconStatusMissing
	}
	if result.Status != db.FavoriteIconStatusMissing && result.Status != db.FavoriteIconStatusRetryable && result.Status != db.FavoriteIconStatusReady {
		result.Status = db.FavoriteIconStatusRetryable
	}

	if err := s.repo.UpdateIcon(favorite.ID, icon, result.Status); err != nil {
		return nil, err
	}
	favorite.Icon = icon
	favorite.IconStatus = result.Status
	return favorite, nil
}

// RemoveFavorite removes a favorite.
func (s *FavoriteService) RemoveFavorite(id int64) error {
	return s.repo.Delete(id)
}

// FavoriteExportItem is a favorite entry for export.
type FavoriteExportItem struct {
	Title  string  `json:"title"`
	URL    string  `json:"url"`
	Icon   *string `json:"icon,omitempty"`
	Folder *string `json:"folder,omitempty"`
}

// ExportFavorites exports favorites as a JSON string.
func (s *FavoriteService) ExportFavorites() (string, error) {
	favs, err := s.repo.FindAll("DESC")
	if err != nil {
		return "", err
	}

	items := make([]FavoriteExportItem, 0, len(favs))
	for _, f := range favs {
		items = append(items, FavoriteExportItem{
			Title:  f.Title,
			URL:    f.URL,
			Icon:   f.Icon,
			Folder: f.Folder,
		})
	}

	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ImportFavorites imports favorites in bulk.
func (s *FavoriteService) ImportFavorites(inputs []*AddFavoriteInput) error {
	favs := make([]*db.Favorite, 0, len(inputs))
	for _, input := range inputs {
		favs = append(favs, &db.Favorite{
			Title:      input.Title,
			URL:        input.URL,
			Icon:       input.Icon,
			IconStatus: initialFavoriteIconStatus(input.Icon),
			Folder:     normalizeFolder(input.Folder),
		})
	}
	_, err := s.repo.CreateMany(favs)
	return err
}

func initialFavoriteIconStatus(icon *string) db.FavoriteIconStatus {
	if icon != nil && strings.TrimSpace(*icon) != "" {
		return db.FavoriteIconStatusReady
	}
	return db.FavoriteIconStatusUnresolved
}
