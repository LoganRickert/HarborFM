import { useState } from 'react';
import { Crown, Phone, User } from 'lucide-react';

type ParticipantRoleIconProps = {
  isHost: boolean;
  source?: 'phone';
  castPhotoUrl?: string | null;
  className: string;
  photoClassName: string;
};

/** Roster avatar: cast photo when present, else Crown / Phone / User. */
export function ParticipantRoleIcon({
  isHost,
  source,
  castPhotoUrl,
  className,
  photoClassName,
}: ParticipantRoleIconProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = Boolean(castPhotoUrl) && !photoFailed && source !== 'phone';

  return (
    <span className={className} aria-hidden>
      {showPhoto ? (
        <img
          src={castPhotoUrl!}
          alt=""
          className={photoClassName}
          data-testid="call-participant-cast-photo"
          onError={() => setPhotoFailed(true)}
        />
      ) : isHost ? (
        <Crown size={14} />
      ) : source === 'phone' ? (
        <Phone size={14} />
      ) : (
        <User size={14} />
      )}
    </span>
  );
}
