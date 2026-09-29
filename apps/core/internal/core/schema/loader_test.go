package schema

import "testing"

func TestLoadSchemasFromJSONUsesBuiltInDefaultsForEmptyPath(t *testing.T) {
	loaded, err := LoadSchemasFromJSON("")
	if err != nil {
		t.Fatal(err)
	}
	want := DefaultSchemas()
	if len(loaded.Schemas) != len(want.Schemas) {
		t.Fatalf("loaded %d schemas, want %d", len(loaded.Schemas), len(want.Schemas))
	}
}
