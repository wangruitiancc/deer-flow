"use client";

import {
  MonitorSmartphoneIcon,
  MoonIcon,
  SunIcon,
  SunriseIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { enUS, isLocale, zhCN, type Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import {
  APPEARANCE_EVENT,
  APPEARANCE_KEY,
  SOLAR_CITIES,
  parseAppearance,
  solarAppearance,
  type AppearanceMode,
  type SolarCityId,
} from "@/core/settings/solar-theme";
import { cn } from "@/lib/utils";

import { SettingsSection } from "./settings-section";

const languageOptions: { value: Locale; label: string }[] = [
  { value: "en-US", label: enUS.locale.localName },
  { value: "zh-CN", label: zhCN.locale.localName },
];

export function AppearanceSettingsPage() {
  const { t, locale, changeLocale } = useI18n();
  const { theme, setTheme, systemTheme } = useTheme();
  const [preferenceMode, setPreferenceMode] = useState<AppearanceMode | null>(
    null,
  );
  const [city, setCity] = useState<SolarCityId>("shanghai");
  const currentTheme =
    preferenceMode ??
    (theme === "dark" || theme === "light" ? theme : "system");
  useEffect(() => {
    const refresh = () => {
      try {
        const preference = parseAppearance(
          localStorage.getItem(APPEARANCE_KEY),
        );
        setPreferenceMode(preference?.mode ?? null);
        setCity(preference?.city ?? "shanghai");
      } catch {
        /* Existing next-themes mode remains available. */
      }
    };
    refresh();
    window.addEventListener(APPEARANCE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const chooseAppearance = (mode: AppearanceMode, selectedCity = city) => {
    setPreferenceMode(mode);
    setCity(selectedCity);
    try {
      localStorage.setItem(
        APPEARANCE_KEY,
        JSON.stringify({ mode, city: selectedCity }),
      );
      window.dispatchEvent(new Event(APPEARANCE_EVENT));
    } catch {
      /* Apply the selection for this page even without persistence. */
    }
    setTheme(
      mode === "solar" ? solarAppearance(new Date(), selectedCity) : mode,
    );
  };

  const themeOptions = useMemo(
    () => [
      {
        id: "system",
        label: t.settings.appearance.system,
        description: t.settings.appearance.systemDescription,
        icon: MonitorSmartphoneIcon,
      },
      {
        id: "light",
        label: t.settings.appearance.light,
        description: t.settings.appearance.lightDescription,
        icon: SunIcon,
      },
      {
        id: "dark",
        label: t.settings.appearance.dark,
        description: t.settings.appearance.darkDescription,
        icon: MoonIcon,
      },
      {
        id: "solar",
        label: "日出日落",
        description: "按所选城市的日出日落自动切换",
        icon: SunriseIcon,
      },
    ],
    [
      t.settings.appearance.dark,
      t.settings.appearance.darkDescription,
      t.settings.appearance.light,
      t.settings.appearance.lightDescription,
      t.settings.appearance.system,
      t.settings.appearance.systemDescription,
    ],
  );

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t.settings.appearance.themeTitle}
        description={t.settings.appearance.themeDescription}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {themeOptions.map((option) => (
            <ThemePreviewCard
              key={option.id}
              icon={option.icon}
              label={option.label}
              description={option.description}
              active={currentTheme === option.id}
              mode={
                option.id === "solar"
                  ? solarAppearance(new Date(), city)
                  : (option.id as "system" | "light" | "dark")
              }
              systemTheme={systemTheme}
              onSelect={() => chooseAppearance(option.id as AppearanceMode)}
            />
          ))}
        </div>
        {currentTheme === "solar" && (
          <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>日出日落城市</span>
            <select
              aria-label="日出日落城市"
              value={city}
              onChange={(event) =>
                chooseAppearance("solar", event.target.value as SolarCityId)
              }
              className="bg-background rounded-md border px-3 py-2"
            >
              {SOLAR_CITIES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">
              手动选择城市，无需定位权限。
            </span>
          </label>
        )}
      </SettingsSection>

      <Separator />

      <SettingsSection
        title={t.settings.appearance.languageTitle}
        description={t.settings.appearance.languageDescription}
      >
        <Select
          value={locale}
          onValueChange={(value) => {
            if (isLocale(value)) {
              changeLocale(value);
            }
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languageOptions.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsSection>
    </div>
  );
}

function ThemePreviewCard({
  icon: Icon,
  label,
  description,
  active,
  mode,
  systemTheme,
  onSelect,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  description: string;
  active: boolean;
  mode: "system" | "light" | "dark";
  systemTheme?: string;
  onSelect: (mode: "system" | "light" | "dark") => void;
}) {
  const previewMode =
    mode === "system" ? (systemTheme === "dark" ? "dark" : "light") : mode;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border p-4 text-left transition-all",
        active
          ? "border-primary ring-primary/30 shadow-sm ring-2"
          : "hover:border-border hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="bg-muted rounded-md p-2">
          <Icon className="size-4" />
        </div>
        <div className="space-y-1">
          <div className="text-sm leading-none font-semibold">{label}</div>
          <p className="text-muted-foreground text-xs leading-snug">
            {description}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "relative overflow-hidden rounded-md border text-xs transition-colors",
          previewMode === "dark"
            ? "border-neutral-800 bg-neutral-900 text-neutral-200"
            : "border-slate-200 bg-white text-slate-900",
        )}
      >
        <div className="border-border/50 flex items-center gap-2 border-b px-3 py-2">
          <div className={cn("h-2 w-2 rounded-full", "bg-primary")} />
          <div className="h-2 w-10 rounded-full bg-current/20" />
          <div className="h-2 w-6 rounded-full bg-current/15" />
        </div>
        <div className="grid grid-cols-[1fr_240px] gap-3 px-3 py-3">
          <div className="space-y-2">
            <div className="h-3 w-3/4 rounded-full bg-current/15" />
            <div className="h-3 w-1/2 rounded-full bg-current/10" />
            <div className="h-[90px] rounded-md border border-current/10 bg-current/5" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-md bg-current/10" />
              <div className="space-y-2">
                <div className="h-2 w-14 rounded-full bg-current/15" />
                <div className="h-2 w-10 rounded-full bg-current/10" />
              </div>
            </div>
            <div className="flex flex-col gap-1 rounded-md border border-dashed border-current/15 p-2">
              <div className="h-2 w-3/5 rounded-full bg-current/15" />
              <div className="h-2 w-2/5 rounded-full bg-current/10" />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
