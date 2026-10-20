import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { isReadOnly, canCorrect } from '@/lib/permissions';
import { Button } from '@/components/ui/button';

// Query, navigation and print controls keep using the regular Button.
export const WriteButton = React.forwardRef((/** @type {React.ComponentProps<typeof Button>} */ props, ref) => {
  const { user } = useAuth();
  return !user || isReadOnly(user.role) ? null : <Button ref={ref} {...props} />;
});
WriteButton.displayName = 'WriteButton';

export const CorrectionButton = React.forwardRef((/** @type {React.ComponentProps<typeof Button>} */ props, ref) => {
  const { user } = useAuth();
  return canCorrect(user?.role) ? <Button ref={ref} {...props} /> : null;
});
CorrectionButton.displayName = 'CorrectionButton';
