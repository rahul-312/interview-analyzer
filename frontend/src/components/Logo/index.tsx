import Link from 'next/link';
import Image from 'next/image';

/** The app's mark and name. `compact` shows only the mark, for the collapsed sidebar. */
export default function Logo({ compact = false, href = '/applications' }: { compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-lg">
      <Image src="/assets/logo/mark.png" alt="Interview Analyzer" width={40} height={34} className="shrink-0" priority />
      <Image
        src="/assets/logo/wordmark.png"
        alt=""
        width={91}
        height={34}
        priority
        className={`hidden shrink-0 transition-[opacity,visibility] duration-300 ease-in-out motion-reduce:transition-none sm:block ${
          compact ? 'invisible opacity-0' : 'opacity-100'
        }`}
      />
    </Link>
  );
}
