import type { Me } from "@glim/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "../../design/cn";
import { Crest } from "../../design/crest";
import { Icon, type IconName } from "../../design/icons";
import { Avatar } from "../ui/avatar";
import { iconButtonClass } from "../ui/icon-button";
import { Sheet } from "../ui/dialog";
import { Menu } from "../ui/menu";
import { NotificationDot } from "../ui/notification-dot";
import { BackLink } from "./back-link";
import { activeItem, navItems, sectionLinks, type NavItem } from "./nav";

/** A detail page's top bar (§6.2): back to the parent by name, and the course code. */
export interface DetailBar {
  back: { to: Parameters<typeof BackLink>[0]["to"]; label: string };
  code?: string;
}

const DetailBarContext = createContext<(bar: DetailBar | null) => void>(() => undefined);

/**
 * Turns the top bar into a detail bar while the calling page is shown: the back link replaces
 * the crest and name, and the course code sits on the right.
 */
export function useDetailBar(bar: DetailBar): void {
  const setBar = useContext(DetailBarContext);
  const { to, label } = bar.back;
  const { code } = bar;
  useEffect(() => {
    setBar({ back: { to, label }, ...(code === undefined ? {} : { code }) });
    return () => {
      setBar(null);
    };
  }, [setBar, to, label, code]);
}

function CourseCode({ code }: { code: string }) {
  return <span className="shrink-0 font-mono text-code text-brand">{code}</span>;
}

/** The bottom bar holds this many items; beyond it the rest go under "More". */
const BOTTOM_NAV_MAX = 5;

function InstitutionName({ name, testId }: { name: string | undefined; testId?: string }) {
  return name === undefined ? (
    <span className="block h-6 w-40 rounded-sm bg-surface-sunken">
      <span className="sr-only">Loading</span>
    </span>
  ) : (
    <span data-testid={testId} className="truncate text-wordmark text-ink">
      {name}
    </span>
  );
}

function NotificationsLink({ unread }: { unread: boolean }) {
  return (
    <Link
      to="/notifications"
      aria-label={unread ? "Notifications, something new" : "Notifications"}
      className={iconButtonClass}
    >
      <Icon name="bell" />
      {unread ? <NotificationDot className="absolute top-2 right-2" /> : null}
    </Link>
  );
}

function AccountMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const navigate = useNavigate();
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label="Account"
          className="inline-flex size-tap shrink-0 items-center justify-center rounded-pill"
        >
          <Avatar name={name} current />
        </button>
      }
      items={[
        {
          label: "Profile",
          icon: "user",
          onSelect: () => {
            void navigate({ to: "/profile" });
          },
        },
        { label: "Sign out", onSelect: onSignOut },
      ]}
    />
  );
}

const navTargetClass = (current: boolean) =>
  cn(
    "flex min-h-tap flex-1 flex-col items-center justify-center gap-1 text-caption",
    current ? "text-brand" : "text-ink-muted",
  );

/** The icon in its 56 × 30 pill over the label (§9.8); the pill fills in when current. */
function NavPill({ icon, label, current }: { icon: IconName; label: string; current: boolean }) {
  return (
    <>
      <span
        className={cn(
          "flex h-7.5 w-14 items-center justify-center rounded-pill",
          current && "bg-brand-soft",
        )}
      >
        <Icon name={icon} size={22} />
      </span>
      {label}
    </>
  );
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      to={item.to}
      aria-current={current ? "page" : undefined}
      className={navTargetClass(current)}
    >
      <NavPill icon={item.icon} label={item.label} current={current} />
    </Link>
  );
}

function BottomNav({ items, current }: { items: NavItem[]; current: NavItem | undefined }) {
  const [more, setMore] = useState(false);
  const overflow = items.length > BOTTOM_NAV_MAX;
  const shown = overflow ? items.slice(0, BOTTOM_NAV_MAX - 1) : items;
  const rest = overflow ? items.slice(BOTTOM_NAV_MAX - 1) : [];
  const moreIsCurrent = rest.some((item) => item.to === current?.to);
  return (
    <nav
      aria-label="Main"
      className="glim-safe-bottom z-nav shrink-0 border-t border-line bg-surface-raised shadow-sheet lg:hidden"
    >
      <div className="flex h-nav items-stretch px-2">
        {shown.map((item) => (
          <NavLink key={item.to} item={item} current={item.to === current?.to} />
        ))}
        {overflow ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={more}
            onClick={() => {
              setMore(true);
            }}
            className={navTargetClass(moreIsCurrent)}
          >
            <NavPill icon="menu" label="More" current={moreIsCurrent} />
          </button>
        ) : null}
      </div>
      <Sheet open={more} onOpenChange={setMore} title="More">
        <ul className="divide-y divide-line">
          {rest.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                aria-current={item.to === current?.to ? "page" : undefined}
                onClick={() => {
                  setMore(false);
                }}
                className="flex min-h-tap items-center gap-3 py-2 text-body text-ink aria-[current=page]:text-brand"
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </nav>
  );
}

function NavRail({ items, current }: { items: NavItem[]; current: NavItem | undefined }) {
  return (
    <nav
      aria-label="Main"
      className="hidden w-22 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-surface-raised py-4 lg:flex"
    >
      <div className="mb-2">
        <Crest size={36} />
      </div>
      {items.map((item) => (
        <div key={item.to} className="flex w-full">
          <NavLink item={item} current={item.to === current?.to} />
        </div>
      ))}
    </nav>
  );
}

/** Links between the pages of one area (Academic: Calendar, Offerings…), above the page. */
function SectionNav({ pathname, me }: { pathname: string; me: Me }) {
  const links = sectionLinks(pathname, me.roles);
  if (links.length === 0) return null;
  return (
    <nav aria-label="Section" className="overflow-x-auto">
      <div className="flex gap-1 border-b border-line">
        {links.map((link) => {
          const current = pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              aria-current={current ? "page" : undefined}
              className={cn(
                "-mb-px flex min-h-tap shrink-0 items-center border-b-3 px-3 text-label whitespace-nowrap",
                current
                  ? "border-brand text-brand"
                  : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The signed-in app (docs/ui-design-handoff.md §6.2): on phones and tablets a top bar, the page,
 * and a bottom navigation bar; from 1024px a left rail. Only the page scrolls.
 */
export function AppShell({
  me,
  institutionName,
  unread,
  onSignOut,
  children,
}: {
  me: Me;
  institutionName: string | undefined;
  unread: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const [detail, setDetail] = useState<DetailBar | null>(null);
  const items = navItems(me.roles);
  const current = activeItem(pathname, items);
  const actions = (
    <div className="flex shrink-0 items-center">
      <NotificationsLink unread={unread} />
      <AccountMenu name={me.user.displayName} onSignOut={onSignOut} />
    </div>
  );
  return (
    <DetailBarContext.Provider value={setDetail}>
      <div className="flex h-dvh bg-surface text-ink">
        <NavRail items={items} current={current} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glim-safe-top z-nav shrink-0 border-b border-line bg-surface-raised lg:hidden">
            <div className="flex h-14 items-center justify-between gap-2 pr-1 pl-4">
              {detail ? (
                <>
                  <BackLink to={detail.back.to} label={detail.back.label} />
                  {detail.code ? (
                    <span className="pr-3">
                      <CourseCode code={detail.code} />
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <Link to="/" className="flex min-w-0 items-center gap-2">
                    <Crest size={28} />
                    <InstitutionName name={institutionName} testId="institution-name" />
                  </Link>
                  {actions}
                </>
              )}
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="glim-gutter mx-auto w-full max-w-content space-y-5 pt-4 pb-5 lg:pt-6 lg:pb-8">
              <div className="hidden items-center justify-between gap-4 lg:flex">
                {detail ? (
                  <BackLink to={detail.back.to} label={detail.back.label} />
                ) : (
                  <InstitutionName name={institutionName} />
                )}
                {actions}
              </div>
              <SectionNav pathname={pathname} me={me} />
              {children}
            </div>
          </main>
          <BottomNav items={items} current={current} />
        </div>
      </div>
    </DetailBarContext.Provider>
  );
}

/** Pages for people who aren't signed in: the crest and name over a centred column. */
export function SignedOutShell({
  institutionName,
  children,
}: {
  institutionName: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="glim-safe-top flex h-14 items-center gap-2 border-b border-line bg-surface-raised px-4">
        <Crest size={28} />
        <InstitutionName name={institutionName} testId="institution-name" />
      </header>
      <main className="glim-gutter mx-auto w-full max-w-3xl py-6">{children}</main>
    </div>
  );
}
