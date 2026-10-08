export function AuthorAvatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1f9e76] to-[#0e7490] font-semibold text-white shadow-[0_0_24px_rgb(70_200_157/0.35)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
