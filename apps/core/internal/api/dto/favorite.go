package dto

// AddFavoriteReq Add favorite request.
// Title is optional; when empty the server falls back to the URL so the
// entry still has a human-visible label.
type AddFavoriteReq struct {
	Title  string  `json:"title"`
	URL    string  `json:"url" binding:"required"`
	Icon   *string `json:"icon"`
	Folder *string `json:"folder"`
}

// UpdateFavoriteReq Update favorite request. Only the provided fields are
// changed; Folder may be set to an empty string to move an entry out of any
// folder (ungrouped).
type UpdateFavoriteReq struct {
	Title  *string `json:"title"`
	Folder *string `json:"folder"`
}

// ImportFavoritesReq Import favorites request.
type ImportFavoritesReq struct {
	Favorites []AddFavoriteReq `json:"favorites" binding:"required"`
}
