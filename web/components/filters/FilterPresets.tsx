'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Save, Trash2, Star, Edit2, Check, X } from 'lucide-react';
import type { FilterValue } from './VisualFilterBuilder';

/**
 * FilterPresets - Phase 3: Real-Time Experience
 *
 * Manages saved filter presets with localStorage persistence.
 * Allows users to save, load, rename, and delete filter configurations.
 *
 * Features:
 * - Save current filters as preset
 * - Load saved presets
 * - Rename presets
 * - Delete presets
 * - localStorage persistence
 * - Preset list with metadata
 */

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterValue;
  createdAt: number;
  lastUsed: number;
}

export interface FilterPresetsProps {
  currentFilters: FilterValue;
  onLoadPreset: (filters: FilterValue) => void;
  className?: string;
}

const STORAGE_KEY = 'ipodhan-filter-presets';

export function FilterPresets({
  currentFilters,
  onLoadPreset,
  className = '',
}: FilterPresetsProps) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Load presets from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setPresets(parsed);
      }
    } catch (error) {
      console.error('[FilterPresets] Failed to load presets:', error);
    }
  }, []);

  // Save presets to localStorage
  const saveToStorage = useCallback((newPresets: FilterPreset[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newPresets));
      setPresets(newPresets);
    } catch (error) {
      console.error('[FilterPresets] Failed to save presets:', error);
    }
  }, []);

  // Create new preset
  const createPreset = useCallback(() => {
    if (!newPresetName.trim()) return;

    const preset: FilterPreset = {
      id: `preset-${Date.now()}`,
      name: newPresetName.trim(),
      filters: currentFilters,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    const newPresets = [...presets, preset];
    saveToStorage(newPresets);

    setNewPresetName('');
    setIsCreating(false);
  }, [newPresetName, currentFilters, presets, saveToStorage]);

  // Load preset
  const loadPreset = useCallback(
    (preset: FilterPreset) => {
      onLoadPreset(preset.filters);

      // Update last used timestamp
      const updatedPresets = presets.map((p) =>
        p.id === preset.id ? { ...p, lastUsed: Date.now() } : p
      );
      saveToStorage(updatedPresets);
    },
    [onLoadPreset, presets, saveToStorage]
  );

  // Delete preset
  const deletePreset = useCallback(
    (id: string) => {
      const newPresets = presets.filter((p) => p.id !== id);
      saveToStorage(newPresets);
    },
    [presets, saveToStorage]
  );

  // Start renaming
  const startRename = useCallback((preset: FilterPreset) => {
    setEditingId(preset.id);
    setEditingName(preset.name);
  }, []);

  // Save rename
  const saveRename = useCallback(() => {
    if (!editingName.trim() || !editingId) return;

    const updatedPresets = presets.map((p) =>
      p.id === editingId ? { ...p, name: editingName.trim() } : p
    );
    saveToStorage(updatedPresets);

    setEditingId(null);
    setEditingName('');
  }, [editingId, editingName, presets, saveToStorage]);

  // Cancel rename
  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

    const days = Math.floor(seconds / 86400);
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;

    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  };

  // Count active filters in preset
  const countActiveFilters = (filters: FilterValue): number => {
    let count = 0;
    count += filters.segments.length;
    count += filters.statuses.length;
    count += filters.sectors.length;
    if (filters.scoreRange[0] > 0 || filters.scoreRange[1] < 10) count++;
    if (filters.subscriptionRange[0] > 0 || filters.subscriptionRange[1] < 100) count++;
    if (filters.priceRange[0] > 0 || filters.priceRange[1] < 10000) count++;
    return count;
  };

  return (
    <div className={`filter-presets ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Saved Presets</h4>
        </div>

        {/* Create new preset button */}
        {!isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Save Current
          </button>
        )}
      </div>

      {/* Create preset form */}
      {isCreating && (
        <div className="mb-4 p-3 rounded-lg border border-border bg-muted/50">
          <input
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createPreset();
              if (e.key === 'Escape') setIsCreating(false);
            }}
            placeholder="Enter preset name..."
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary mb-2"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              onClick={createPreset}
              disabled={!newPresetName.trim()}
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Preset
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewPresetName('');
              }}
              className="px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Preset list */}
      <div className="space-y-2">
        {presets.length === 0 && !isCreating && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No saved presets yet.
            <br />
            Save your first preset to quickly access filter combinations.
          </div>
        )}

        {presets.map((preset) => (
          <div
            key={preset.id}
            className="group rounded-lg border border-border bg-card p-3 hover:border-primary/50 transition-all"
          >
            {/* Preset header */}
            <div className="flex items-start justify-between mb-2">
              {editingId === preset.id ? (
                // Rename input
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') cancelRename();
                    }}
                    className="flex-1 px-2 py-1 rounded border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    autoFocus
                  />
                  <button
                    onClick={saveRename}
                    className="p-1 rounded hover:bg-muted text-success"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={cancelRename}
                    className="p-1 rounded hover:bg-muted text-danger"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                // Preset name
                <div className="flex-1">
                  <h5 className="text-sm font-semibold text-foreground mb-1">
                    {preset.name}
                  </h5>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{countActiveFilters(preset.filters)} filters</span>
                    <span>•</span>
                    <span>{formatRelativeTime(preset.lastUsed)}</span>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {editingId !== preset.id && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startRename(preset)}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Rename"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deletePreset(preset.id)}
                    className="p-1.5 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Load button */}
            {editingId !== preset.id && (
              <button
                onClick={() => loadPreset(preset)}
                className="w-full py-2 rounded-md bg-muted hover:bg-muted/80 text-foreground text-sm font-medium transition-colors"
              >
                Load Preset
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Info footer */}
      {presets.length > 0 && (
        <div className="mt-4 text-xs text-muted-foreground">
          {presets.length} saved preset{presets.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export default FilterPresets;
