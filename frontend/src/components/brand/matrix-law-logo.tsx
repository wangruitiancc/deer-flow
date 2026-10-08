import Image from "next/image";

type MatrixLawLogoProps = {
  className?: string;
  markSize?: number;
  wordmarkClassName?: string;
};

export function MatrixLawMark({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <Image
      src="/images/matrix-law-symbol.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
    />
  );
}

export function MatrixLawLogo({
  className,
  markSize = 28,
  wordmarkClassName,
}: MatrixLawLogoProps) {
  return (
    <span className={className}>
      <MatrixLawMark size={markSize} />
      <span className={wordmarkClassName}>Matrix-Law</span>
    </span>
  );
}
