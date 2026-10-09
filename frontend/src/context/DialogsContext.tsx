'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import ApplicationForm from '@/components/ApplicationForm';
import Modal from '@/components/Modal';
import RoundForm from '@/components/RoundForm';
import Button from '@/components/ui/Button';
import type { Application } from '@/models/Application';
import type { InterviewRound } from '@/models/Interview';
import { useAuth } from './AuthContext';
import { RefreshContext } from './RefreshContext';

interface AddApplicationOptions {
  afterCreate?: (app: Application) => void;
}

interface RoundFormOptions {
  applicationId?: number;
  round?: InterviewRound;
  withDebrief?: boolean;
  afterSave?: (round: InterviewRound) => void;
}

interface DialogsState {
  openAddApplication: (options?: AddApplicationOptions) => void;
  openRoundForm: (options?: RoundFormOptions) => void;
  bump: () => void;
}

const DialogsContext = createContext<DialogsState | null>(null);

export const useDialogs = () => {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error('useDialogs must be used inside <DialogsProvider>');
  return ctx;
};

const roundFormTitle = (options: RoundFormOptions) => {
  if (!options.round) return 'Log an interview round';
  return options.withDebrief ? 'Write debrief' : 'Edit round';
};

/** Owns the shared "add application" and "round form" pop-ups, and the refresh key. */
export const DialogsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [addApp, setAddApp] = useState<AddApplicationOptions | null>(null);
  const [roundForm, setRoundForm] = useState<RoundFormOptions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { refreshUser } = useAuth();

  // Anything saved through a dialog can change usage, so refresh it along with the data
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    refreshUser();
  }, [refreshKey, refreshUser]);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const openAddApplication = useCallback((options: AddApplicationOptions = {}) => setAddApp(options), []);
  const openRoundForm = useCallback((options: RoundFormOptions = {}) => setRoundForm(options), []);
  const closeAddApp = useCallback(() => setAddApp(null), []);
  const closeRoundForm = useCallback(() => setRoundForm(null), []);

  const dialogs = useMemo(() => ({ openAddApplication, openRoundForm, bump }), [openAddApplication, openRoundForm, bump]);
  const refresh = useMemo(() => ({ key: refreshKey, bump }), [refreshKey, bump]);

  return (
    <RefreshContext.Provider value={refresh}>
      <DialogsContext.Provider value={dialogs}>
        {children}

        {/* Add application */}
        {addApp && (
          <Modal title="Add application" onClose={closeAddApp}>
            <ApplicationForm
              quick
              onCancel={closeAddApp}
              onSaved={(app) => {
                setAddApp(null);
                bump();
                addApp.afterCreate?.(app);
              }}
            />
          </Modal>
        )}

        {/* Log or edit a round */}
        {roundForm && (
          <Modal wide title={roundFormTitle(roundForm)} onClose={closeRoundForm}>
            <RoundForm
              applicationId={roundForm.applicationId}
              round={roundForm.round}
              withDebrief={roundForm.withDebrief}
              onCancel={closeRoundForm}
              onSaved={(round) => {
                setRoundForm(null);
                bump();
                // The daily limit stopped the analysis: say so, the debrief is still saved
                if (round.analysis_limited) setNotice(round.analysis_limit_message ?? 'Daily analysis limit reached.');
                roundForm.afterSave?.(round);
              }}
            />
          </Modal>
        )}

        {/* Notice */}
        {notice && (
          <div
            role="status"
            className="fixed inset-x-4xl bottom-[5.5rem] z-50 mx-auto flex max-w-modal md:bottom-6xl items-start gap-2xl rounded-xl border border-amber-light bg-white p-4xl text-sm shadow-lg"
          >
            <Info size={18} className="mt-xs shrink-0 text-amber" />
            <p className="flex-1 text-charcoal-gray">{notice}</p>
            <Button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-light-silver hover:text-dark-gray">
              <X size={16} />
            </Button>
          </div>
        )}
      </DialogsContext.Provider>
    </RefreshContext.Provider>
  );
};
