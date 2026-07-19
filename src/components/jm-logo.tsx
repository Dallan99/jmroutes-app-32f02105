export function JmLogo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      aria-label="JM Transportes"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background: "linear-gradient(135deg, #f59e0b, #b45309)",
        color: "white",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.42,
        letterSpacing: "-0.03em",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      JM
    </div>
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
