import Link from 'next/link';
import Image from 'next/image';

/** The app's mark and name. `compact` shows only the mark, for the collapsed sidebar. */
export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/applications" className="flex items-center gap-lg font-semibold">
      <Image src="/assets/logo/logo.svg" alt="Interview Analyzer" width={40} height={40} priority />
      <span
        className={`hidden whitespace-nowrap font-serif text-lg font-medium transition-[opacity,visibility] duration-300 ease-in-out motion-reduce:transition-none sm:inline ${
          compact ? 'invisible opacity-0' : 'opacity-100'
        }`}
      >
        Interview Analyzer
      </span>
    </Link>
  );
}
