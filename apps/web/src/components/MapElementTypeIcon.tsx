import {
  mapElementBareIcon,
  mapElementColor,
  mapElementHasIcon,
  mapElementSvgInner,
  type MapElementType,
} from '../lib/map-elements'

/** Icono de elemento del mapa para UI (lista, modal, etc.). */
export function MapElementTypeIcon({
  type,
  size = 22,
  className = '',
}: {
  type: MapElementType
  size?: number
  className?: string
}) {
  if (!mapElementHasIcon(type)) return null

  const color = mapElementColor[type]
  const bare = mapElementBareIcon(type)
  const stroke = bare ? color : '#fff'
  const inner = mapElementSvgInner(type, stroke)
  const svgSize = bare ? size : Math.round(size * 0.68)

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${bare ? '' : 'rounded-md'} ${className}`}
      style={
        bare
          ? {
              width: size,
              height: Math.round(size * 1.2),
              background: 'transparent',
            }
          : {
              width: size,
              height: size,
              background: color,
              boxShadow: '0 0 0 1px rgba(255,255,255,.25)',
            }
      }
      aria-hidden
    >
      <svg
        width={svgSize}
        height={bare ? Math.round(size * 1.15) : svgSize}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </span>
  )
}
