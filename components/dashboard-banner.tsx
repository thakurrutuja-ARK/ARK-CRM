export function DashboardBanner() {
  return (
    <div className="relative overflow-hidden rounded-3xl mb-8 shadow-md h-40 sm:h-52">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1600&h=500&q=80"
        alt=""
        className="h-full w-full object-cover"
      />
    </div>
  );
}
