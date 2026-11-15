import Image from "next/image";
import Link from "next/link";

/** The navbar title: the Trojan Connect icon and name, linking home. */
export function Brand({ href = "/", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.01em] ${className}`}>
      <Image src="/brand/trojan-connect-icon.png" alt="" width={32} height={32} className="size-8 shrink-0" priority />
      Trojan Connect
    </Link>
  );
}
