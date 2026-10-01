import Image from 'next/image';
import { isRemoteImage } from '@/lib/image';
import { cn } from '@/lib/utils';
import { categoryMeta } from './category-meta';

type Props = {
  category: string;
  /** 同じカテゴリでも色を変えるための値（slug など） */
  seed?: string;
  image?: { url: string; alt: string } | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  iconClassName?: string;
};

/** プランの写真。写真が未登録のときはカテゴリの色とアイコンのカバーを出す */
export function PlanCover({ category, seed, image, alt, sizes, priority, className, iconClassName }: Props) {
  if (image) {
    return (
      <div className={cn('relative overflow-hidden bg-foam', className)}>
        <Image
          unoptimized={isRemoteImage(image.url)}
          src={image.url}
          alt={image.alt || alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      </div>
    );
  }
  const { icon: Icon, gradient, hue, pattern, decor } = categoryMeta(category, seed);
  return (
    <div
      className={cn('relative overflow-hidden bg-gradient-to-br', gradient, hue, className)}
      role="img"
      aria-label={alt}
    >
      <div className={cn('absolute inset-0', pattern)} />
      <div className={cn('absolute rounded-full bg-white/10', decor[0])} />
      <div className={cn('absolute rounded-full bg-white/10', decor[1])} />
      <Icon
        aria-hidden
        strokeWidth={1.4}
        className={cn('absolute right-5 bottom-5 size-16 text-white/85 drop-shadow-sm', iconClassName)}
      />
    </div>
  );
}
