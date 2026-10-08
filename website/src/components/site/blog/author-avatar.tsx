"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * The GitHub avatar of the author, looked up by the name in the frontmatter,
 * which is their GitHub username. The initial sits below it, so it shows
 * while the picture loads and stays when GitHub has no such user or cannot be
 * reached.
 */
export function AuthorAvatar({ name, size }: { name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#1f9e76] to-[#0e7490] font-semibold text-white shadow-[0_0_24px_rgb(70_200_157/0.35)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {name.charAt(0).toUpperCase()}
      {!failed && (
        <Image
          src={`https://github.com/${encodeURIComponent(name)}.png?size=${size * 2}`}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
