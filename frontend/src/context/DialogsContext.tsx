'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import ApplicationForm from '@/components/ApplicationForm';
import Modal from '@/components/Modal';
import RoundForm from '@/components/RoundForm';
import type { Application } from '@/models/Application';
import type { InterviewRound } from '@/models/Interview';
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
                roundForm.afterSave?.(round);
              }}
            />
          </Modal>
        )}
      </DialogsContext.Provider>
    </RefreshContext.Provider>
  );
};
