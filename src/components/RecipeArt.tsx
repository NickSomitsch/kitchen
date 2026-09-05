import { useId, useMemo } from 'react'
import { recipeArt, seededRandom, type RecipeArtSpec } from '../lib/recipeArt'

/** Where the food sits, per vessel, as a clip region and a scatter box. */
const PLATING = {
  bowl: { cx: 200, cy: 104, rx: 74, ry: 26 },
  plate: { cx: 200, cy: 116, rx: 76, ry: 24 },
  pan: { cx: 190, cy: 112, rx: 62, ry: 32 },
  bake: { cx: 200, cy: 116, rx: 88, ry: 30 },
  glass: { cx: 200, cy: 116, rx: 34, ry: 44 },
} as const

function Vessel({ spec, clipId }: { spec: RecipeArtSpec; clipId: string }) {
  const { palette, motif } = spec
  const stroke = palette.rim
  switch (motif) {
    case 'bowl':
      return (
        <>
          <path
            d="M118 100 A82 82 0 0 0 282 100 Z"
            fill={palette.vessel} stroke={stroke} strokeWidth="3"
          />
          <ellipse cx="200" cy="100" rx="82" ry="24" fill={palette.vessel} stroke={stroke} strokeWidth="3" />
          <ellipse cx="200" cy="100" rx="74" ry="19" fill={palette.shade} opacity=".45" />
          <clipPath id={clipId}><ellipse cx="200" cy="100" rx="72" ry="18" /></clipPath>
        </>
      )
    case 'pan':
      return (
        <>
          <rect x="252" y="104" width="118" height="13" rx="6.5" fill={stroke} />
          <ellipse cx="190" cy="112" rx="78" ry="40" fill={palette.vessel} stroke={stroke} strokeWidth="3" />
          <ellipse cx="190" cy="112" rx="66" ry="31" fill={palette.shade} opacity=".5" />
          <clipPath id={clipId}><ellipse cx="190" cy="112" rx="64" ry="29" /></clipPath>
        </>
      )
    case 'bake':
      return (
        <>
          <rect x="96" y="80" width="208" height="74" rx="12" fill={palette.vessel} stroke={stroke} strokeWidth="3" />
          <rect x="108" y="90" width="184" height="54" rx="7" fill={palette.shade} opacity=".55" />
          <clipPath id={clipId}><rect x="110" y="92" width="180" height="50" rx="6" /></clipPath>
        </>
      )
    case 'glass':
      return (
        <>
          <path d="M168 68 H232 L224 162 A6 6 0 0 1 218 167 H182 A6 6 0 0 1 176 162 Z"
            fill={palette.vessel} stroke={stroke} strokeWidth="3" />
          <clipPath id={clipId}>
            <path d="M170 72 H230 L223 160 A4 4 0 0 1 219 163 H181 A4 4 0 0 1 177 160 Z" />
          </clipPath>
        </>
      )
    default:
      return (
        <>
          <ellipse cx="200" cy="116" rx="96" ry="32" fill={palette.vessel} stroke={stroke} strokeWidth="3" />
          <ellipse cx="200" cy="116" rx="76" ry="23" fill={palette.shade} opacity=".4" />
          <clipPath id={clipId}><ellipse cx="200" cy="116" rx="74" ry="22" /></clipPath>
        </>
      )
  }
}

/** The food itself: one blob per ingredient colour, scattered inside the vessel. */
function Food({ spec }: { spec: RecipeArtSpec }) {
  const shapes = useMemo(() => {
    const random = seededRandom(spec.seed)
    const box = PLATING[spec.motif]
    const count = spec.motif === 'glass' ? 4 : 11
    return Array.from({ length: count }, (_, index) => {
      const colour = spec.fills[index % spec.fills.length]
      if (spec.motif === 'glass') {
        // A drink layers rather than scatters.
        return {
          kind: 'band' as const, colour,
          y: box.cy - box.ry + (index * (box.ry * 2)) / count,
          height: (box.ry * 2) / count + 1,
        }
      }
      const angle = random() * Math.PI * 2
      const spread = 0.35 + random() * 0.62
      return {
        kind: 'blob' as const, colour,
        cx: box.cx + Math.cos(angle) * box.rx * spread,
        cy: box.cy + Math.sin(angle) * box.ry * spread,
        r: 7 + random() * 9,
        squash: 0.72 + random() * 0.4,
      }
    })
  }, [spec])

  return (
    <>
      {shapes.map((shape, index) => (shape.kind === 'band' ? (
        <rect key={index} x="160" y={shape.y} width="80" height={shape.height} fill={shape.colour} opacity=".92" />
      ) : (
        <ellipse
          key={index}
          cx={shape.cx} cy={shape.cy}
          rx={shape.r} ry={shape.r * shape.squash}
          fill={shape.colour}
          opacity=".95"
        />
      )))}
    </>
  )
}

/**
 * A generated illustration of a dish, used wherever a recipe has no photograph.
 * Identical input always draws the identical picture.
 */
export function RecipeArt({
  name,
  tags = [],
  ingredients = [],
  className = 'recipe-thumb',
}: {
  name: string
  tags?: readonly string[]
  ingredients?: readonly string[]
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const spec = useMemo(() => recipeArt(name, tags, ingredients), [name, tags, ingredients])
  const clipId = `${id}-plate`
  const skyId = `${id}-sky`

  return (
    <svg
      className={className}
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Illustration of ${name}`}
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={spec.palette.base} />
          <stop offset="100%" stopColor={spec.palette.shade} />
        </linearGradient>
      </defs>
      <rect width="400" height="200" fill={`url(#${skyId})`} />
      <circle cx="326" cy="46" r="30" fill={spec.palette.vessel} opacity=".45" />
      <circle cx="72" cy="34" r="18" fill={spec.palette.vessel} opacity=".3" />
      <ellipse cx="200" cy="176" rx="104" ry="12" fill={spec.palette.rim} opacity=".35" />
      <Vessel spec={spec} clipId={clipId} />
      <g clipPath={`url(#${clipId})`}><Food spec={spec} /></g>
    </svg>
  )
}
