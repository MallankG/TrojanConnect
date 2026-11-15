"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu, Popover } from "radix-ui";
import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  Compass,
  House,
  Inbox,
  Landmark,
  Library,
  MessageCircle,
  Plus,
  Ticket,
  Users,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { api, useDb, useUser } from "@/lib/api/client";
import type { DemoUser, Role } from "@/lib/api/types";
import { useSound } from "@/lib/sound/SoundProvider";
import { sound } from "@/lib/sound/engine";
import { fmtRelative } from "@/lib/time";
import { Avatar, Button, ListSkeleton, ToastProvider, buttonClass, useToast } from "@/components/ui/kit";

type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV: Record<Role, NavItem[]> = {
  club_rep: [
    { href: "/dashboard", label: "Home", icon: House },
    { href: "/bookings", label: "Bookings", icon: Ticket },
    { href: "/conversations", label: "Chats", icon: MessageCircle },
    { href: "/club-profile", label: "Club", icon: Users },
  ],
  venue_reviewer: [{ href: "/venue-review", label: "Review queue", icon: ClipboardCheck }],
  student: [
    { href: "/dashboard", label: "Home", icon: House },
    { href: "/discover", label: "Discover", icon: Compass },
    { href: "/events", label: "Events", icon: CalendarDays },
    { href: "/government", label: "Student gov", icon: Landmark },
    { href: "/conversations", label: "Chats", icon: MessageCircle },
  ],
  gov_rep: [
    { href: "/government", label: "Assistant", icon: Landmark },
    { href: "/government/knowledge", label: "Sources", icon: Library },
    { href: "/government/feedback", label: "Feedback", icon: Inbox },
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  club_rep: "Club representative",
  venue_reviewer: "Venue reviewer",
  student: "Student",
  gov_rep: "USG representative",
};

export const HOME: Record<Role, string> = {
  club_rep: "/dashboard",
  venue_reviewer: "/venue-review",
  student: "/dashboard",
  gov_rep: "/government",
};

function isActive(pathname: string, href: string, all: NavItem[]) {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // A longer sibling (e.g. /government/feedback) wins over its parent.
  return !all.some((n) => n.href !== href && n.href.startsWith(href) && pathname.startsWith(n.href));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useUser();
  const router = useRouter();

  // The app cues sit under the interface, quieter than the landing page.
  useEffect(() => {
    sound.setLevel(0.45);
    return () => sound.setLevel(0.8);
  }, []);

  useEffect(() => {
    if (user === null) router.replace("/demo");
  }, [user, router]);

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-3xl px-5 py-24">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <p className="bg-gold-25 px-4 py-1.5 text-center text-[13px] text-ink">
          Demo mode. Data is seeded and venue availability is simulated. No real reservation is
          made.
        </p>
        <TopBar user={user} />
        <main className="flex-1 pb-28 md:pb-16">{children}</main>
        <MobileTabs role={user.role} />
      </div>
    </ToastProvider>
  );
}

function TopBar({ user }: { user: DemoUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { on, toggle } = useSound();
  const nav = NAV[user.role];

  const createRequest = () => {
    const result = api.startBooking();
    if (!result.ok) return toast(result.error.message, "bad");
    sound.play("send");
    router.push(`/conversations/${result.data.conversationId}`);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-5">
        <Link href={HOME[user.role]} className="text-lg font-semibold tracking-[-0.01em]">
          TrojanConnect
        </Link>

        <nav aria-label="Sections" className="hidden justify-center gap-1 md:flex">
          {nav.map((item) => {
            const active = isActive(pathname, item.href, nav);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-[15px] transition-colors ${
                  active ? "bg-wash font-semibold text-ink" : "text-gray-70 hover:text-ink"
                }`}
              >
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <span className="md:hidden" />

        <div className="flex items-center gap-1.5">
          {user.role === "club_rep" && (
            <span className="hidden lg:block">
              <Button variant="primary" onClick={createRequest}>
                <Plus aria-hidden className="size-4" />
                Create event request
              </Button>
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-pressed={on}
            aria-label={on ? "Turn sound off" : "Turn sound on"}
            className="grid size-10 place-items-center rounded-full hover:bg-wash"
          >
            {on ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
          </button>
          <Notifications user={user} />
          <ProfileMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function Notifications({ user }: { user: DemoUser }) {
  const db = useDb();
  const items = db.notifications.filter((n) => n.userId === user.id).slice(0, 8);
  const unread = items.filter((n) => !n.read).length;

  return (
    <Popover.Root onOpenChange={(open) => !open && unread > 0 && api.markNotificationsRead()}>
      <Popover.Trigger
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-10 place-items-center rounded-full hover:bg-wash"
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-cardinal" />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(92vw,360px)] rounded-2xl border border-line bg-paper p-2 shadow-xl"
        >
          <p className="px-3 pb-1 pt-2 text-sm font-semibold">Notifications</p>
          {items.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-sm text-gray-70">Nothing yet. Updates on your requests appear here.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id}>
                  <Popover.Close asChild>
                    <Link href={n.href} className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 hover:bg-wash">
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-gray-30" : "bg-cardinal"}`}
                      />
                      <span className="min-w-0">
                        <span className="block text-[15px] leading-snug">{n.text}</span>
                        <span className="text-xs text-gray-70">{fmtRelative(n.at)}</span>
                      </span>
                    </Link>
                  </Popover.Close>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ProfileMenu({ user }: { user: DemoUser }) {
  const item = "flex cursor-pointer items-center rounded-lg px-3 py-2 text-[15px] outline-none data-[highlighted]:bg-wash";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label="Account menu" className="rounded-full">
        <Avatar name={user.name} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-2xl border border-line bg-paper p-2 shadow-xl"
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="text-[15px] font-semibold">{user.name}</p>
            <p className="text-sm text-gray-70">
              {ROLE_LABEL[user.role]}
              {user.scopeName ? `, ${user.scopeName}` : ""}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href="/demo" className={item}>Switch role</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/settings" className={item}>Settings</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/" className={item}>Back to the story</Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Floating pill tab bar on phones, as in the Luma reference. */
function MobileTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const nav = NAV[role];
  if (nav.length < 2) return null;
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 md:hidden"
    >
      <div className="flex gap-1 rounded-full border border-line bg-paper/95 p-1.5 shadow-lg backdrop-blur">
        {nav.map((item) => {
          const active = isActive(pathname, item.href, nav);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-12 min-w-14 flex-col items-center justify-center rounded-full px-2.5 text-[11px] ${
                active ? "bg-wash font-semibold text-ink" : "text-gray-70"
              }`}
            >
              <item.icon aria-hidden className="size-[18px]" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Wraps page content in the centred column. */
export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-5 py-8 md:py-12 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>{children}</div>;
}

/** Shows the page only to the listed roles; everyone else gets a plain explanation. */
export function Only({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const user = useUser();
  if (!user) return null;
  if (roles.includes(user.role)) return <>{children}</>;
  return (
    <Page>
      <div className="rounded-2xl border border-dashed border-gray-30 px-6 py-12 text-center">
        <p className="text-lg font-semibold">This page is for {roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(" and ")} accounts</p>
        <p className="mx-auto mt-1 max-w-sm text-[15px] text-gray-70">
          You are signed in to the demo as {ROLE_LABEL[user.role].toLowerCase()}, which has no access here.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href={HOME[user.role]} className={buttonClass("secondary")}>Go to your home</Link>
          <Link href="/demo" className={buttonClass("primary")}>Switch role</Link>
        </div>
      </div>
    </Page>
  );
}
