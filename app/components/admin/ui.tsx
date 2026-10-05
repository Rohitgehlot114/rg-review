import { useId, type ReactNode } from "react";
import { NavLink, useSearchParams } from "react-router";

const STAR_PATH =
  "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";
const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#008060]";

const nav = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/reviews", label: "Reviews" },
  { to: "/app/review-requests", label: "Review Requests" },
  { to: "/app/settings", label: "Settings" },
] as const;

export function useAdminHref() {
  const [params] = useSearchParams();
  return (href: string) => {
    const [path, query = ""] = href.split("?");
    const next = new URLSearchParams(query);
    for (const key of ["shop", "host", "embedded"]) {
      const value = params.get(key);
      if (value && !next.has(key)) next.set(key, value);
    }
    const search = next.toString();
    return search ? `${path}?${search}` : path;
  };
}

export function AdminLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const hrefFor = useAdminHref();
  return (
    <a className={className} href={hrefFor(href)}>
      {children}
    </a>
  );
}

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const hrefFor = useAdminHref();
  return (
    <div className="min-h-screen w-full overflow-x-clip bg-[#f6f6f7] text-[#202223]">
      <div className="mx-auto w-full min-w-0 max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#008060]">Tattoo Review</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <p className="mt-1 max-w-3xl text-sm text-[#6d7175]">{subtitle}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </header>
        <nav aria-label="Tattoo Review" className="mt-5 overflow-x-auto border-b border-[#e1e3e5]">
          <div className="flex w-max min-w-full gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={hrefFor(item.to)}
                end={"end" in item ? item.end : undefined}
                className={({ isActive }) =>
                  `inline-flex shrink-0 items-center whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${focus} ${
                    isActive
                      ? "border-[#008060] bg-[#f1f8f5] text-[#008060]"
                      : "border-transparent text-[#6d7175] hover:bg-[#f1f2f3] hover:text-[#202223]"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="mt-5 grid min-w-0 gap-4">{children}</div>
      </div>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[#e3e3e3] bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:p-5 ${className}`}
    >
      {title || action ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Button({
  href,
  children,
  variant = "primary",
  type = "button",
  onClick,
  disabled,
}: {
  href?: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const hrefFor = useAdminHref();
  const className = `inline-flex min-h-10 items-center justify-center rounded-lg px-3 text-sm font-semibold ${focus} disabled:cursor-not-allowed disabled:opacity-60 ${
    variant === "primary"
      ? "bg-[#008060] text-white hover:bg-[#006e52]"
      : "border border-[#c9cccf] bg-white text-[#202223] hover:bg-[#f6f6f7]"
  }`;
  if (href) {
    return (
      <a className={className} href={hrefFor(href)}>
        {children}
      </a>
    );
  }
  return (
    <button className={className} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "critical" | "neutral";
  children: ReactNode;
}) {
  const tones = {
    success: "bg-[#e3f1df] text-[#0c5132]",
    warning: "bg-[#fff5ea] text-[#8a6116]",
    critical: "bg-[#fee9e8] text-[#8e1f0b]",
    neutral: "bg-[#f1f2f3] text-[#202223]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#c9cccf] bg-white px-4 py-10 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#6d7175]">{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function RatingStars({
  rating,
  label,
  size = 16,
}: {
  rating: number;
  label: string;
  size?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((index) => {
        const fill = Math.min(1, Math.max(0, rating - index));
        return (
          <svg key={index} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="shrink-0">
            <defs>
              <clipPath id={`${id}-${index}`}>
                <rect x="0" y="0" width={24 * fill} height="24" />
              </clipPath>
            </defs>
            <path d={STAR_PATH} fill="#D9DDE3" />
            {fill > 0 ? <path d={STAR_PATH} fill="#F5B301" clipPath={`url(#${id}-${index})`} /> : null}
          </svg>
        );
      })}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-[#f1f2f3]" role="img" aria-label={label}>
      <span className="block h-full rounded-full bg-[#008060]" style={{ width: `${width}%` }} />
    </span>
  );
}
