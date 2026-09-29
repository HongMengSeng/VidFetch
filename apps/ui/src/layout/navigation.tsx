import {
  BadgeCheck,
  CloudDownload,
  FileCog,
  ScanSearch,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { isWeb } from "@/utils";

export interface NavigationItem {
  active: boolean;
  Icon: LucideIcon;
  key: "home" | "done" | "converter" | "source" | "settings";
  label: string;
  to: string;
}

export function useNavigationItems(): NavigationItem[] {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items: NavigationItem[] = [
    {
      key: "home",
      to: "/",
      label: t("downloadList"),
      Icon: CloudDownload,
      active: pathname === "/",
    },
    {
      key: "done",
      to: "/done",
      label: t("downloadComplete"),
      Icon: BadgeCheck,
      active: pathname === "/done",
    },
    {
      key: "converter",
      to: "/converter",
      label: t("converter"),
      Icon: FileCog,
      active: pathname === "/converter",
    },
    {
      key: "source",
      to: "/source",
      label: t("materialExtraction"),
      Icon: ScanSearch,
      active: pathname === "/source",
    },
    {
      key: "settings",
      to: "/settings",
      label: t("setting"),
      Icon: Settings,
      active: pathname === "/settings",
    },
  ];

  return isWeb
    ? items.filter((item) => item.key !== "source" && item.key !== "converter")
    : items;
}
