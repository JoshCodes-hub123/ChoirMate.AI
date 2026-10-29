import React, { useState } from 'react';
import { X, Check, User } from 'lucide-react';

interface HeaderProps {
  currentScreen?: 'home' | 'workspace' | 'results' | 'practice';
  onNavigate?: (screen: 'home' | 'workspace' | 'results' | 'practice') => void;
  hasScore?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onNavigate,
}) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [userRole, setUserRole] = useState<'guest' | 'chorister' | 'director'>('chorister');
  const [signedIn, setSignedIn] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#FAF5ED]/95 backdrop-blur-md border-b border-[#E8E0D0]/80 transition-colors">
        <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-14 min-h-[72px] flex items-center justify-between">
          {/* Left: Sole ChoirMate AI Logo Mark (no text beside it) */}
          <button
            type="button"
            onClick={() => onNavigate?.('home')}
            className="flex items-center text-left group cursor-pointer focus:outline-none min-h-[44px] transition-transform hover:opacity-90 active:scale-[0.98]"
            aria-label="ChoirMate Home"
          >
            <img
              src="/assets/choirmate_logo_mark.png"
              alt="ChoirMate AI Logo"
              className="h-10 sm:h-11 w-auto object-contain block"
              loading="eager"
              decoding="async"
              width={34}
              height={44}
            />
          </button>

          {/* Right: Sole Sign in Action */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setShowSignInModal(true)}
              className="min-h-[42px] px-6 py-2 rounded-full border border-[#143826] text-[#143826] hover:bg-[#143826]/5 text-sm font-medium transition-all cursor-pointer flex items-center gap-2 active:scale-[0.98]"
            >
              {signedIn ? (
                <>
                  <User className="w-4 h-4 text-[#143826]" />
                  <span className="capitalize">{userRole}</span>
                </>
              ) : (
                <span>Sign in</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Sign-in Modal */}
      {showSignInModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#FAF5ED] border border-[#E4DCCF] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative text-[#16221A] animate-in fade-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => setShowSignInModal(false)}
              className="absolute top-5 right-5 text-[#738279] hover:text-[#16221A] p-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E7B35]">
                OPEN//BUILD 2026 • Chorister Pass
              </span>
              <h3 className="font-serif text-2xl font-bold text-[#143826] mt-1">
                Welcome to ChoirMate AI
              </h3>
              <p className="text-xs text-[#506056] mt-2 leading-relaxed">
                Save rehearsal recordings, track vocal pitch progress, and synchronize scores across your choir section.
              </p>
            </div>

            <div className="space-y-3 mb-6">
              {[
                { id: 'chorister', label: 'Chorister (Soprano / Alto / Tenor / Bass)', desc: 'Practise vocal parts with solfa and pitch feedback' },
                { id: 'director', label: 'Choir Director / Conductor', desc: 'Distribute rehearsal MP3s, correct notes, and export scores' },
                { id: 'guest', label: 'Guest Sight-Singer', desc: 'Immediate instant access with no account required' },
              ].map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setUserRole(role.id as 'guest' | 'chorister' | 'director')}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    userRole === role.id
                      ? 'border-[#143826] bg-[#143826]/5 shadow-xs'
                      : 'border-[#E4DCCF] bg-white hover:border-[#143826]/40'
                  }`}
                >
                  <div>
                    <p className="text-xs font-semibold text-[#143826]">{role.label}</p>
                    <p className="text-[11px] text-[#637269] mt-0.5">{role.desc}</p>
                  </div>
                  {userRole === role.id && (
                    <div className="w-5 h-5 rounded-full bg-[#143826] text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3 h-3" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setSignedIn(true);
                  setShowSignInModal(false);
                }}
                className="flex-1 py-3 px-4 rounded-full bg-[#143826] hover:bg-[#1B4A34] text-white font-medium text-xs transition-colors cursor-pointer"
              >
                Continue as {userRole.charAt(0).toUpperCase() + userRole.slice(1)}
              </button>
              <button
                type="button"
                onClick={() => setShowSignInModal(false)}
                className="py-3 px-4 rounded-full border border-[#D5CBBB] text-[#506056] hover:bg-black/5 text-xs transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
