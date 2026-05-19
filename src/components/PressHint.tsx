import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';

type HintChildProps = {
  'aria-describedby'?: string;
};

type PressHintProps = {
  message: string;
  children: ReactElement;
  className?: string;
};

export default function PressHint({ message, children, className = '' }: PressHintProps) {
  const tooltipId = useId();
  const touchTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [touchVisible, setTouchVisible] = useState(false);

  const clearTouchTimer = () => {
    if (touchTimerRef.current) {
      window.clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const hideTooltipSoon = () => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setTouchVisible(false);
    }, 1800);
  };

  useEffect(() => {
    return () => {
      clearTouchTimer();
      clearHideTimer();
    };
  }, []);

  const child =
    isValidElement<HintChildProps>(children)
      ? cloneElement(children, {
          'aria-describedby': tooltipId,
        })
      : children;

  return (
    <div
      className={`group relative inline-flex ${className}`.trim()}
      onTouchStart={() => {
        clearHideTimer();
        clearTouchTimer();
        touchTimerRef.current = window.setTimeout(() => {
          setTouchVisible(true);
          touchTimerRef.current = null;
        }, 420);
      }}
      onTouchEnd={() => {
        clearTouchTimer();
        if (touchVisible) hideTooltipSoon();
      }}
      onTouchCancel={() => {
        clearTouchTimer();
        clearHideTimer();
        setTouchVisible(false);
      }}
    >
      {child}
      <div
        id={tooltipId}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-2xl bg-brand-brown px-3 py-2 text-center text-xs font-medium leading-5 text-white shadow-lg transition-all duration-200 ${
          touchVisible
            ? 'translate-y-0 opacity-100'
            : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100'
        }`}
      >
        {message}
      </div>
    </div>
  );
}
