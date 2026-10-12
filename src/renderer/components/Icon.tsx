export function Icon({ name, size = 24, className = '' }: { name: string; size?: number; className?: string }) {
  return <img src={`./icons/${name}.png`} width={size} height={size} alt="" draggable={false} className={`inline-block shrink-0 select-none ${className}`} style={{ width: size, height: size }} />
}
