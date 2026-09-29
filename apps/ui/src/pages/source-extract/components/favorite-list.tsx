import { useMemoizedFn } from "ahooks";
import { Folder, Plus, ScanSearch } from "lucide-react";
import { type FormEvent, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import emptyError from "@/assets/images/empty-states/empty-error.png";
import emptyFavorites from "@/assets/images/empty-states/empty-favorites.png";
import { AppEmptyState } from "@/components/app-empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ADD_FAVORITE, OPEN_FAVORITE } from "@/const";
import { tdApp } from "@/utils";
import { isWeb } from "@/environment";
import { FavItem } from "./fav-item";
import { useFavorites } from "@/hooks/use-favorites";
import { useFavoriteScrape } from "@/hooks/use-favorite-scrape";
import { usePlatform } from "@/hooks/use-platform";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { getPageTitle } from "@/api/util";
import { useFavoriteIconResolution } from "./use-favorite-icon-resolution";

// Ungrouped favorites collapse to this sentinel folder key.
const UNGROUPED = "";

export function FavoriteList() {
  const {
    data: favoriteList,
    isLoading,
    error,
    addFavorite,
    updateFavorite,
    removeFavorite,
    resolveFavoriteIcon,
    mutate,
  } = useFavorites();
  const { scrapeSites, isScraping, cancel: cancelScrape } = useFavoriteScrape();
  const { contextMenu } = usePlatform();
  const { createTab, loadUrl } = useBrowserActions();
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [scrapingKey, setScrapingKey] = useState<string | null>(null);
  const urlInputId = useId();
  const titleInputId = useId();
  const folderInputId = useId();
  useFavoriteIconResolution(favoriteList, resolveFavoriteIcon);

  const { groups, folderNames } = useMemo(() => {
    const map = new Map<string, Favorite[]>();
    for (const item of favoriteList) {
      const key = item.folder?.trim() || UNGROUPED;
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    const sorted = [...map.entries()].sort((a, b) => {
      if (a[0] === b[0]) return 0;
      if (a[0] === UNGROUPED) return 1;
      if (b[0] === UNGROUPED) return -1;
      return a[0].localeCompare(b[0]);
    });
    const names = sorted
      .map(([key]) => key)
      .filter((key) => key !== UNGROUPED);
    return { groups: sorted, folderNames: names };
  }, [favoriteList]);

  const onClickLoadItem = useMemoizedFn((item: Favorite) => {
    loadUrl(item.url);
    tdApp.onEvent(OPEN_FAVORITE);
  });

  const handleRemoveFavorite = useMemoizedFn(async (id: number) => {
    await removeFavorite(id);
  });

  const resetForm = useMemoizedFn(() => {
    setEditingId(null);
    setUrl("");
    setTitle("");
    setFolder("");
    setUrlError(null);
  });

  const showModal = useMemoizedFn(() => {
    resetForm();
    setIsModalOpen(true);
    tdApp.onEvent(ADD_FAVORITE);
  });

  const showEditModal = useMemoizedFn((item: Favorite) => {
    setEditingId(item.id);
    setUrl(item.url);
    setTitle(item.title);
    setFolder(item.folder?.trim() ?? "");
    setUrlError(null);
    setIsModalOpen(true);
  });

  const handleOk = useMemoizedFn(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (editingId === null) {
      if (!url) {
        setUrlError(t("pleaseEnterSiteUrl"));
        return;
      }
      if (!/^https?:\/\/.+/.test(url)) {
        setUrlError(t("pleaseEnterCorrectUrl"));
        return;
      }
    }

    setUrlError(null);
    try {
      if (editingId === null) {
        await addFavorite({
          url,
          title,
          folder: folder.trim() || undefined,
        });
      } else {
        await updateFavorite(editingId, {
          title: title.trim() || url,
          folder,
        });
      }
      resetForm();
      setIsModalOpen(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : editingId === null
            ? t("addFavoriteFailed")
            : t("updateFavoriteFailed"),
      );
    }
  });

  const handleCancel = useMemoizedFn(() => {
    resetForm();
    setIsModalOpen(false);
  });

  const handleOpenChange = useMemoizedFn((open: boolean) => {
    if (!open) resetForm();
    setIsModalOpen(open);
  });

  // Auto-fill the title from the page's <title> tag when the user leaves
  // the URL field, unless they already typed a title themselves.
  const handleUrlBlur = useMemoizedFn(async () => {
    if (editingId !== null) return;
    if (!url || !/^https?:\/\/.+/.test(url)) return;
    if (title) return;
    try {
      const { data: pageTitle } = await getPageTitle(url);
      // Re-check: the user may have typed something while we were fetching.
      if (pageTitle) {
        setTitle((currentTitle) => currentTitle || pageTitle);
      }
    } catch {
      // Best-effort: leave title blank if fetch fails; server falls back to URL.
    }
  });

  const handleScrape = useMemoizedFn(async (key: string, items: Favorite[]) => {
    const urls = items.map((item) => item.url).filter(Boolean);
    if (urls.length === 0) {
      toast.info(t("scrapeNoSites"));
      return;
    }
    setScrapingKey(key);
    toast.info(t("scrapeStarted", { count: urls.length }));
    try {
      const outcome = await scrapeSites(urls);
      if (outcome.created > 0) {
        toast.success(t("scrapeResult", { count: outcome.created }));
      } else if (outcome.failed > 0) {
        toast.error(t("scrapeFailed"));
      } else {
        toast.info(t("scrapeEmpty"));
      }
      await mutate();
    } catch {
      toast.error(t("scrapeFailed"));
    } finally {
      setScrapingKey(null);
    }
  });

  const handleContextMenu = useMemoizedFn(async (item: Favorite) => {
    const items: Parameters<typeof contextMenu.show>[0] = [
      { key: "open", label: t("open") },
      { key: "open-new-tab", label: t("openInNewTab") },
      { key: "edit", label: t("editFavorite") },
    ];
    if (item.folder?.trim()) {
      items.push({
        key: "remove-from-folder",
        label: t("removeFromFolder"),
      });
    }
    items.push({ key: "separator", label: "", type: "separator" });
    items.push({ key: "delete", label: t("delete") });
    const action = await contextMenu.show(items);
    if (action === "open") {
      loadUrl(item.url);
    } else if (action === "open-new-tab") {
      await createTab(item.url);
    } else if (action === "edit") {
      showEditModal(item);
    } else if (action === "remove-from-folder") {
      await updateFavorite(item.id, { folder: "" });
    } else if (action === "delete") {
      await removeFavorite(item.id);
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <AppEmptyState
          compact
          illustration={emptyError}
          title={t("loadFailed")}
          description={t("loadFailedDescription")}
          actions={
            <Button type="button" onClick={() => void mutate()}>
              {t("refresh")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-auto px-4 py-4">
      {favoriteList.length === 0 ? (
        <AppEmptyState
          className="min-h-full"
          illustration={emptyFavorites}
          title={t("emptyFavoritesTitle")}
          description={t("emptyFavoritesDescription")}
          actions={
            <Button type="button" onClick={showModal}>
              <Plus />
              {t("addFavorite")}
            </Button>
          }
        />
      ) : (
        <>
          {groups.map(([key, items]) => {
            const isScrapingThis = scrapingKey === key && isScraping;
            return (
              <section key={key || UNGROUPED} className="flex flex-col gap-3">
                <header className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Folder className="size-4 text-muted-foreground" />
                    <span>{key || t("ungrouped")}</span>
                    <span className="text-xs text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  {!isWeb ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isScraping && !isScrapingThis}
                      onClick={() =>
                        isScrapingThis
                          ? cancelScrape()
                          : void handleScrape(key, items)
                      }
                    >
                      {isScrapingThis ? (
                        <>
                          <Spinner className="size-4" />
                          {t("scraping")}
                        </>
                      ) : (
                        <>
                          <ScanSearch className="size-4" />
                          {t("scrapeFolder")}
                        </>
                      )}
                    </Button>
                  ) : null}
                </header>
                <div className="grid grid-cols-4 place-items-center gap-4 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9">
                  {items.map((item) => (
                    <FavItem
                      key={item.id}
                      onContextMenu={() => handleContextMenu(item)}
                      onClick={() => onClickLoadItem(item)}
                      onClose={() => handleRemoveFavorite(item.id)}
                      src={item.icon ?? undefined}
                      title={item.title}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          <div className="grid grid-cols-4 place-items-center gap-4 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9">
            <FavItem
              onClick={showModal}
              icon={<Plus className="size-5" />}
              title={t("addFavorite")}
            />
          </div>
        </>
      )}
      <Dialog open={isModalOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <form className="flex flex-col gap-4" noValidate onSubmit={handleOk}>
            <DialogHeader>
              <DialogTitle>
                {editingId === null ? t("addShortcut") : t("editFavorite")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("pleaseEnterSiteUrl")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-36 flex-col justify-center gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor={urlInputId}>
                  {t("siteUrl")}
                </label>
                <Input
                  id={urlInputId}
                  name="url"
                  value={url}
                  autoFocus={editingId === null}
                  disabled={editingId !== null}
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={
                    urlError ? `${urlInputId}-error` : undefined
                  }
                  onChange={(event) => {
                    setUrl(event.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  placeholder={t("pleaseEnterSiteUrl")}
                  onBlur={handleUrlBlur}
                />
                {urlError ? (
                  <p
                    id={`${urlInputId}-error`}
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {urlError}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor={titleInputId}>
                  {t("siteName")}
                </label>
                <Input
                  id={titleInputId}
                  name="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t("pleaseEnterSiteName")}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium" htmlFor={folderInputId}>
                  {t("favoriteFolder")}
                </label>
                <Input
                  id={folderInputId}
                  name="folder"
                  list={`${folderInputId}-options`}
                  value={folder}
                  onChange={(event) => setFolder(event.target.value)}
                  placeholder={t("favoriteFolderPlaceholder")}
                />
                <datalist id={`${folderInputId}-options`}>
                  {folderNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancel}>
                {t("cancel")}
              </Button>
              <Button type="submit">{t("confirm")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
