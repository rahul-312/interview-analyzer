import Link from 'next/link';
import Image from 'next/image';

export default function Logo() {
  return (
    <Link href="/applications" className="flex items-center gap-lg font-semibold">
      <Image src="/assets/logo/logo.svg" alt="Interview Analyzer" width={32} height={32} priority />
      <span className="hidden sm:inline">Interview Analyzer</span>
    </Link>
  );
}
