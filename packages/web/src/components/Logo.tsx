import type { SVGProps } from 'react';

export function Logo(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            {/* Scale / Balance representation */}
            <path d="M12 3v18" />
            <path d="M6 8l-4 4 4 4" />
            <path d="M18 8l4 4-4 4" />
            <rect x="10" y="10" width="4" height="4" rx="1" />
        </svg>
    );
}

export function BrandLogo(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            {...props}
        >
            <circle cx="16" cy="16" r="16" fill="url(#logo-gradient)" />
            <path
                d="M16 6V26M8 12L6 16L8 20M24 12L26 16L24 20M13 14H19V18H13V14Z"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <defs>
                <linearGradient
                    id="logo-gradient"
                    x1="0"
                    y1="0"
                    x2="32"
                    y2="32"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop stopColor="#004502" />
                    <stop offset="1" stopColor="#9B7E46" />
                </linearGradient>
            </defs>
        </svg>
    );
}
