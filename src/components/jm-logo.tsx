import { JM_LOGO_DATA_URL } from "@/assets/brand-images";

export function JmLogo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={JM_LOGO_DATA_URL}
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
