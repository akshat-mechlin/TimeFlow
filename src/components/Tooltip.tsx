import React, { useState, useRef, useEffect, useCallback } from 'react'

interface TooltipProps {
  content: string
  children: React.ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

const Tooltip: React.FC<TooltipProps> = ({ 
  content, 
  children, 
  position = 'top',
  delay = 200 
}) => {
  const [isVisible, setIsVisible] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const updatePosition = useCallback((mouseX: number, mouseY: number) => {
    if (!tooltipRef.current) return

    const tooltipRect = tooltipRef.current.getBoundingClientRect()
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft

    // Offset from cursor (in pixels)
    const offset = 12

    let top = 0
    let left = 0

    // Position tooltip near cursor based on position prop
    switch (position) {
      case 'top':
        top = mouseY + scrollTop - tooltipRect.height - offset
        left = mouseX + scrollLeft - (tooltipRect.width / 2)
        break
      case 'bottom':
        top = mouseY + scrollTop + offset
        left = mouseX + scrollLeft - (tooltipRect.width / 2)
        break
      case 'left':
        top = mouseY + scrollTop - (tooltipRect.height / 2)
        left = mouseX + scrollLeft - tooltipRect.width - offset
        break
      case 'right':
        top = mouseY + scrollTop - (tooltipRect.height / 2)
        left = mouseX + scrollLeft + offset
        break
      default:
        // Default: position below and to the right of cursor
        top = mouseY + scrollTop + offset
        left = mouseX + scrollLeft + offset
    }

    // Keep tooltip within viewport
    const padding = 8
    if (left < padding) left = padding
    if (left + tooltipRect.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltipRect.width - padding
    }
    if (top < padding + scrollTop) top = padding + scrollTop
    if (top + tooltipRect.height > window.innerHeight + scrollTop - padding) {
      top = window.innerHeight + scrollTop - tooltipRect.height - padding
    }

    setTooltipPosition({ top, left })
  }, [position])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const newPos = { x: e.clientX, y: e.clientY }
    setMousePosition(newPos)
    if (isVisible) {
      updatePosition(newPos.x, newPos.y)
    }
  }, [isVisible, updatePosition])

  const showTooltip = useCallback((e?: React.MouseEvent) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    if (e) {
      const newPos = { x: e.clientX, y: e.clientY }
      setMousePosition(newPos)
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true)
        updatePosition(newPos.x, newPos.y)
      }, delay)
    } else {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true)
        updatePosition(mousePosition.x, mousePosition.y)
      }, delay)
    }
  }, [delay, updatePosition, mousePosition])

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(false)
  }, [])

  useEffect(() => {
    if (isVisible) {
      const handleScroll = () => {
        if (tooltipRef.current) {
          updatePosition(mousePosition.x, mousePosition.y)
        }
      }
      const handleResize = () => {
        if (tooltipRef.current) {
          updatePosition(mousePosition.x, mousePosition.y)
        }
      }
      
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('scroll', handleScroll)
      window.addEventListener('resize', handleResize)
      
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('scroll', handleScroll)
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [isVisible, mousePosition.x, mousePosition.y, handleMouseMove, updatePosition])

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseMove={(e) => {
          setMousePosition({ x: e.clientX, y: e.clientY })
          if (isVisible && tooltipRef.current) {
            updatePosition(e.clientX, e.clientY)
          }
        }}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-block"
      >
        {children}
      </div>
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`fixed z-[10000] px-3 py-2 text-sm text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg pointer-events-none whitespace-normal max-w-xs ${
            position === 'top' ? 'tooltip-arrow-top' :
            position === 'bottom' ? 'tooltip-arrow-bottom' :
            position === 'left' ? 'tooltip-arrow-left' :
            'tooltip-arrow-right'
          }`}
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
          }}
        >
          {content}
        </div>
      )}
    </>
  )
}

export default Tooltip

