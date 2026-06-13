import { useState, type ReactNode } from 'react';
import type { Player } from '../../api/types';
import { useSelection, type ConstraintType } from '../../store/useSelection';
import { Card, btnGhost, inputCls as selectCls } from '../ui';

//Same-team / opposite-team pair constraints fed into the balancer.
export function Constraints({ byId }: { byId: Map<string, Player> }) {
    const { selectedIds, sameTeam, oppositeTeam, addConstraint, removeConstraint } = useSelection();
    const [a, setA] = useState('');
    const [b, setB] = useState('');

    const name = (id: string) => byId.get(id)?.displayName ?? id;
    const options = selectedIds;

    const add = (type: ConstraintType) => {
        if (a && b && a !== b) addConstraint(type, a, b);
    };

    return (
        <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Constraints</h3>
        {selectedIds.length < 2 ? (
            <p className="text-sm text-slate-500">Select at least two players to add constraints.</p>
        ) : (
            <>
            <div className="flex flex-wrap items-center gap-2">
                <select className={selectCls} value={a} onChange={(e) => setA(e.target.value)}>
                    <option value="">Player A…</option>
                    {options.map((id) => (
                        <option key={id} value={id}>
                        {name(id)}
                        </option>
                    ))}
                </select>
                <select className={selectCls} value={b} onChange={(e) => setB(e.target.value)}>
                    <option value="">Player B…</option>
                    {options.map((id) => (
                        <option key={id} value={id}>
                        {name(id)}
                        </option>
                    ))}
                </select>
                <button className={btnGhost} onClick={() => add('same')} type="button">
                Same team
                </button>
                <button className={btnGhost} onClick={() => add('opposite')} type="button">
                Opposite teams
                </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                {sameTeam.map((p, i) => (
                <Chip key={`s${i}`} color="emerald" onRemove={() => removeConstraint('same', i)}>
                    {name(p[0])} = {name(p[1])}
                </Chip>
                ))}
                {oppositeTeam.map((p, i) => (
                <Chip key={`o${i}`} color="rose" onRemove={() => removeConstraint('opposite', i)}>
                    {name(p[0])} ⨯ {name(p[1])}
                </Chip>
                ))}
                {sameTeam.length === 0 && oppositeTeam.length === 0 && (
                <p className="text-sm text-slate-500">No constraints — fully free balancing.</p>
                )}
            </div>
            </>
        )}
        </Card>
    );
}

function Chip({
    children,
    color,
    onRemove,
}: {
    children: ReactNode;
    color: 'emerald' | 'rose';
    onRemove: () => void;
}) {
    const cls =
        color === 'emerald'
        ? 'border-emerald-700/50 bg-emerald-900/30 text-emerald-200'
        : 'border-rose-700/50 bg-rose-900/30 text-rose-200';
    return (
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${cls}`}>
        {children}
        <button onClick={onRemove} className="text-slate-400 hover:text-white" title="Remove">
            ✕
        </button>
        </span>
    );
}
