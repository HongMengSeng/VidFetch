import { cn } from "@/utils";
import LogoImg from "../assets/images/logo.png";

interface AppBrandProps {
  className?: string;
  collapsed?: boolean;
}

export function AppBrand({ className, collapsed = false }: AppBrandProps) {
  return (
    <div
      className={cn(
        "flex h-14 shrink-0 select-none items-center border-b px-3",
        collapsed && "justify-center px-2",
        className,
      )}
    >
      <img
        className={cn("size-7 shrink-0", !collapsed && "mr-2")}
        src={LogoImg}
        alt="MediaGo"
      />
      {!collapsed ? (
        <span className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="whitespace-nowrap text-base leading-4 tracking-[-0.01em]">
            <span className="font-bold">MEDIA</span>
            <span className="font-normal text-foreground-secondary">GO</span>
          </span>
          <span className="whitespace-nowrap text-[10px] font-medium leading-3 text-muted-foreground">
            v{import.meta.env.APP_VERSION}
          </span>
        </span>
      ) : null}
    </div>
  );
}
