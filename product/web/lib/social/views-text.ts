import { countText } from './reply-view.ts';

/**
 * The words of a post's or story's views (R11; docs/social/r11-design.md, section 4, rule 3): "0 views" for none,
 * otherwise the total with its noun, then the different devices in brackets, with the profile's own word for them
 * ("readers", `profile.tsx`): "1 view (1 reader)", "9 views (4 readers)". The unique count is never more than the
 * total, and a total of 0 has no readers to name. Plain, so every page that shows views words them the same way.
 */
export function viewsText(views: number, uniqueViews: number): string {
  const total = countText(views, 'view', 'views');
  return views === 0 ? total : `${total} (${countText(uniqueViews, 'reader', 'readers')})`;
}
