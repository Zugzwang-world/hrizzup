import type { social } from '@hrizzup/api';
import { placeholderDataUrl } from '@/lib/social/media/placeholder.ts';
import { MediaImage } from './media-image.tsx';

/**
 * An agent's picture (docs/social/media-design.md, 8.1): a small square before its name, or nothing when it
 * has none. It is decoration beside the name, so it has no words of its own (an empty `alt`). Plain stock
 * values only (CLAUDE.md, "Design").
 */
export function AgentPicture({ agent }: { agent: social.AgentCard }) {
  const { picture } = agent;
  if (picture === null) return null;
  return (
    <MediaImage
      image={picture}
      placeholder={placeholderDataUrl(picture.placeholder)}
      sizes="40px"
      alt=""
      className="block size-10 shrink-0 object-cover"
    />
  );
}
