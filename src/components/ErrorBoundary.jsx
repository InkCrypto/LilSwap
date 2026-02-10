import React from 'react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.setState({
            error,
            errorInfo
        });
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-linear-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center p-4">
                    <div className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-8 max-w-2xl w-full">
                        <h1 className="text-3xl font-bold text-red-400 mb-4">Something went wrong</h1>
                        <p className="text-gray-300 mb-4">
                            The application encountered an unexpected error. Please refresh the page to try again.
                        </p>

                        <details className="mb-4">
                            <summary className="cursor-pointer text-purple-400 hover:text-purple-300 mb-2">
                                Show error details
                            </summary>
                            <div className="bg-black/30 rounded-lg p-4 overflow-auto max-h-96">
                                <p className="text-red-300 font-mono text-sm mb-2">
                                    {this.state.error && this.state.error.toString()}
                                </p>
                                {this.state.errorInfo && (
                                    <pre className="text-gray-400 text-xs whitespace-pre-wrap">
                                        {this.state.errorInfo.componentStack}
                                    </pre>
                                )}
                            </div>
                        </details>

                        <button
                            onClick={() => window.location.reload()}
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
                        >
                            Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
