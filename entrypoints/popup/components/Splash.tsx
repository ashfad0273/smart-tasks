import Logo from './Logo';

export default function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg">
      <Logo size={52} bob />
      <span className="text-sm font-semibold text-mut">Smart Tasks</span>
    </div>
  );
}
