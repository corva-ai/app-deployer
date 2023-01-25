import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { Button } from '@corva/ui/components';
import userEvent from '@testing-library/user-event';

const Toggle = () => {
  const [isOn, setIsOn] = useState<boolean>(false);

  return (
    <>
      {isOn ? 'ON' : 'OFF'}
      <Button onClick={() => setIsOn(value => !value)}>toggle</Button>
    </>
  );
};

describe('<Toggle />', () => {
  it('should be OFF by default', () => {
    render(<Toggle />);

    expect(screen.getByText('OFF')).toBeInTheDocument();
  });

  it('should switch to ON after a single press', async () => {
    render(<Toggle />);

    userEvent.click(screen.getByText('toggle'));

    await waitFor(() => screen.getByText('ON'));
  });
});
