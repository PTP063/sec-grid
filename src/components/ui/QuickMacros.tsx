import { memo } from 'react';

export interface QuickMacro {
  id: string;
  label: string;
  payload: string;
  badgeColor?: string;
}

const EMERGENCY_MACROS: QuickMacro[] = [
  {
    id: 'trauma',
    label: '[TRAUMA/BLEEDING]',
    payload: 'Severe arterial bleeding. Hemostatic dressing applied. Urgent field medic needed.',
    badgeColor: 'var(--accent-crit)',
  },
  {
    id: 'collapse',
    label: '[STRUCT_COLLAPSE]',
    payload: 'Concrete ceiling collapse. Victims trapped under rubble. Extrication equipment needed.',
    badgeColor: 'var(--accent-warn)',
  },
  {
    id: 'hazmat',
    label: '[HAZMAT/GAS]',
    payload: 'Toxic chemical vapor detected. High respiratory hazard. Perimeter evacuation initiated.',
    badgeColor: 'var(--accent-warn)',
  },
  {
    id: 'fire',
    label: '[ACTIVE_FIRE]',
    payload: 'Structural fire spreading fast. Ingress compromised by dense smoke and heat.',
    badgeColor: 'var(--accent-crit)',
  },
  {
    id: 'o2',
    label: '[O2_DEPLETION]',
    payload: 'Confined space oxygen dropping. Portable ventilation and SCBA units required.',
    badgeColor: 'var(--accent-radar)',
  },
  {
    id: 'evac',
    label: '[EVAC_TRANSPORT]',
    payload: 'Critical triage casualties ready for extraction. Transport team needed at coordinates.',
    badgeColor: 'var(--brutal-white)',
  },
];

interface QuickMacrosProps {
  onSelect: (payload: string) => void;
  disabled?: boolean;
}

export const QuickMacros = memo(function QuickMacros({ onSelect, disabled }: QuickMacrosProps) {
  return (
    <div
      className="flex-row gap-1"
      style={{
        padding: '3px 8px',
        background: 'var(--brutal-dark-grey)',
        borderBottom: '1px solid var(--brutal-grey)',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)', paddingRight: 4 }}>
        MACROS:
      </span>
      {EMERGENCY_MACROS.map((macro) => (
        <button
          key={macro.id}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(macro.payload)}
          className="macro-chip text-sys"
          style={{
            background: 'var(--bg-void)',
            color: macro.badgeColor || 'var(--brutal-white)',
            border: `1px solid ${macro.badgeColor || 'var(--brutal-light-grey)'}`,
            padding: '2px 6px',
            fontSize: 8,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.1s ease',
          }}
          title={macro.payload}
        >
          {macro.label}
        </button>
      ))}
    </div>
  );
});
