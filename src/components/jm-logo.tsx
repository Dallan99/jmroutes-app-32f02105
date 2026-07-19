const LOGO_URL = "/__l5e/assets-v1/13f07280-903f-4674-bc0d-0b29af8f7a51/jm-logo.jpeg";

export function JmLogo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={LOGO_URL}
      alt="JM Transportes"
      width={size}
      height={size}
      className={className}
      style={{
        borderRadius: 6,
        objectFit: "contain",
      }}
    />
  );
}

export function JmWordmark({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <JmLogo size={32} />

      <div className="flex flex-col leading-tight">
        <span className="font-display text-[15px] font-bold tracking-tight text-sidebar-foreground">
          JM Transportes
        </span>

        <span className="text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/60">
          Last Mile
        </span>
      </div>
    </div>
  );
}
