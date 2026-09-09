import { type IconName, icons } from "./paths";

export interface IconProps {
  name: IconName;
  /** Glyph box in px. The layout spec uses 24 (nav), 16 (chips), 12 (metadata). */
  size?: number;
  className?: string;
  /** Omit to leave the icon decorative (aria-hidden) next to a visible label. */
  title?: string;
}

export function Icon({ name, size = 24, className, title }: IconProps) {
  const glyph = icons[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {glyph.stroke.map((d) => (
        <path key={d} d={d} />
      ))}
      {"fill" in glyph && glyph.fill
        ? glyph.fill.map((d) => <path key={d} d={d} fill="currentColor" stroke="none" />)
        : null}
    </svg>
  );
}
