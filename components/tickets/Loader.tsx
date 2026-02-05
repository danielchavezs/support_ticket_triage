export default function Loader(props: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
    const sizeMap = {
        sm: 'h-4 w-4 border-2',
        md: 'h-6 w-6 border-2',
        lg: 'h-10 w-10 border-4',
    };
    const sizeClass = sizeMap[props.size ?? 'md'];

    return (
        <div
            className={`animate-spin rounded-full border-zinc-200 border-t-zinc-900 ${sizeClass} ${props.className ?? ''}`}
            role="status"
            aria-label="Loading"
        />
    );
}
