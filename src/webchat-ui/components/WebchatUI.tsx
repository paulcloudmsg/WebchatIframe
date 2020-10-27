import * as React from 'react';
import { IMessage } from '../../common/interfaces/message';
import Header from './presentational/Header';
import { ThemeProvider } from 'emotion-theming';
import { CacheProvider } from '@emotion/core';
import { IWebchatTheme, createWebchatTheme, styled } from '../style';
import WebchatRoot from './presentational/WebchatRoot';
import { History } from './history/History';
import createCache from '@emotion/cache';
import { isolate } from '../utils/css';
import { MessagePlugin } from '../../common/interfaces/message-plugin';
import FullScreenMessage from './history/FullScreenMessage';
import Input from './plugins/InputPluginRenderer';
import textInputPlugin from './plugins/input/text';
import MessageRow from './presentational/MessageRow';
import MessagePluginRenderer from './plugins/MessagePluginRenderer';
import regularMessagePlugin from './plugins/message/regular';
import { InputPlugin } from '../../common/interfaces/input-plugin';
import stylisRTL from 'stylis-rtl';

import TypingIndicatorBubble from './presentational/TypingIndicatorBubble';
import '../utils/normalize.css';
import { MessageSender } from '../interfaces';
import { ChatScroller } from './history/ChatScroller';
import FAB from './presentational/FAB';
import WebchatWrapper from './presentational/WebchatWrapper';
import ChatIcon from '../assets/baseline-chat-24px.svg';
import CloseIcon from '../assets/baseline-close-24px.svg';
import DisconnectOverlay from './presentational/DisconnectOverlay';
import { IWebchatConfig } from '../../common/interfaces/webchat-config';
import { TTyping } from '../../common/interfaces/typing';
import MessageTeaser from './presentational/MessageTeaser';
import Badge from './presentational/Badge';
import getTextFromMessage from '../../webchat/helper/message';
import notificationSound from '../utils/notification-sound';

export interface WebchatUIProps {
    messages: IMessage[];
    unseenMessages: IMessage[];
    fullscreenMessage?: IMessage;
    onSetFullscreenMessage: (message: IMessage) => void;
    onDismissFullscreenMessage: () => void;

    onSendMessage: MessageSender;
    config: IWebchatConfig;
    typingIndicator: TTyping;

    open: boolean;

    messagePlugins?: MessagePlugin[];
    inputPlugins: InputPlugin[];

    inputMode: string;
    onSetInputMode: (inputMode: string) => void;
    onClose: () => void;
    onToggle: () => void;

    onEmitAnalytics: (event: string, payload?: any) => void;

    webchatRootProps?: React.ComponentProps<typeof WebchatRoot>;
    webchatToggleProps?: React.ComponentProps<typeof FAB>;

    connected: boolean;
    reconnectionLimit: boolean;
}

interface WebchatUIState {
    theme: IWebchatTheme;
    messagePlugins: MessagePlugin[];
    inputPlugins: InputPlugin[];
    /* Initially false, true from the point of first connection */
    hadConnection: boolean;
    lastUnseenMessageText: string;
}

const stylisPlugins = [
    isolate('[data-cognigy-webchat-root]')
];

/**
 * for RTL-layout websites, use the stylis-rtl plugin to convert CSS,
 * e.g. padding-left becomes padding-right etc.
 */
(() => {
    const dir = document.getElementsByTagName('html')[0].attributes['dir'];
    if (dir && dir.value === 'rtl') {
        stylisPlugins.push(stylisRTL);
    }
})();

const styleCache = createCache({
    key: 'cognigy-webchat',
    stylisPlugins
});

const HistoryWrapper = styled(History)(({ theme }) => ({
    overflowY: 'auto',
    flexGrow: 1,
    minHeight: 0,
    height: theme.blockSize
}));

export class WebchatUI extends React.PureComponent<React.HTMLProps<HTMLDivElement> & WebchatUIProps, WebchatUIState> {
    state = {
        theme: createWebchatTheme(),
        messagePlugins: [],
        inputPlugins: [],
        hadConnection: false,
        lastUnseenMessageText: ""
    };

    history: React.RefObject<ChatScroller>;

    private unreadTitleIndicatorInterval: ReturnType<typeof setTimeout> | null = null;
    private originalTitle: string = window.document.title;
    private titleType: 'original' | 'unread' = 'original';

    constructor(props) {
        super(props);

        this.history = React.createRef();
    }

    static getDerivedStateFromProps(props: WebchatUIProps, state: WebchatUIState): WebchatUIState | null {
        const color = props.config && props.config.settings && props.config.settings.colorScheme;

        if (!!color && color !== state.theme.primaryColor) {
            return {
                ...state,
                theme: createWebchatTheme({ primaryColor: color })
            }
        }

        return null;
    }

    componentDidMount() {
        this.setState({
            inputPlugins: [...this.props.inputPlugins || [], textInputPlugin],
            messagePlugins: [...this.props.messagePlugins || [], regularMessagePlugin]
        });
        
        if (this.props.config.settings.enableUnreadMessageTitleIndicator) {
            this.initializeTitleIndicator();
        }
    }

    componentDidUpdate(prevProps: WebchatUIProps, prevState: WebchatUIState) {
        if (this.props.config.settings.colorScheme !== prevProps.config.settings.colorScheme) {
            this.setState({
                theme: createWebchatTheme({ primaryColor: this.props.config.settings.colorScheme })
            })
        }

        if (!prevState.hadConnection && this.props.connected) {
            this.setState({
                hadConnection: true
            })
        }

        if (prevProps.unseenMessages !== this.props.unseenMessages) {
            const { unseenMessages } = this.props;

            // update the "unseen message preview" text
            if (this.props.config.settings.enableUnreadMessagePreview) {
                let lastUnseenMessageText = '';
                
                if (unseenMessages.length > 0) {
                    const lastUnseenMessage = unseenMessages[unseenMessages.length - 1];
                    lastUnseenMessageText = getTextFromMessage(lastUnseenMessage);
                }

                this.setState({
                    lastUnseenMessageText
                });
            }

            // play a notification for unread messages
            if (unseenMessages.length > 0 && this.props.config.settings.enableUnreadMessageSound) {
                notificationSound.play();
            }
        }

        // initialize the title indicator if configured
        if (
            this.props.config.settings.enableUnreadMessageTitleIndicator 
            && this.props.config.settings.enableUnreadMessageTitleIndicator !== prevProps.config.settings.enableUnreadMessageTitleIndicator
        ) {
            this.initializeTitleIndicator();
        }
    }

    componentWillUnmount() {
        /**
         * this tears down the "unread messages" title indicator
         */
        if (this.unreadTitleIndicatorInterval) {
            clearInterval(this.unreadTitleIndicatorInterval);
            this.unreadTitleIndicatorInterval = null;
        }
    }
    
    /**
     * This sets up the "unread messages" title indicator interval.
     * It should only be registered once!
     */
    initializeTitleIndicator = () => {
        if (this.unreadTitleIndicatorInterval)
            return;

        this.unreadTitleIndicatorInterval = setInterval(this.toggleTitleIndicator, 1000);
    }

    toggleTitleIndicator = () => {
        if (this.titleType === 'unread') {
            document.title = this.originalTitle;
            this.titleType = 'original';
        } else {
            if (this.props.unseenMessages.length > 0) {
                document.title = `(${this.props.unseenMessages.length}) ${this.props.config.settings.unreadMessageTitleText}`;
                this.titleType = 'unread';
            }
        }
    }

    sendMessage: MessageSender = (...args) => {
        if (this.history.current) {
            this.history.current.scrollToBottom();
        }

        this.props.onSendMessage(...args);
    }

    renderInput = () => {
        const { inputPlugins } = this.state;

        return (
            <Input
                plugins={inputPlugins}
                messages={this.props.messages}
                onSendMessage={this.sendMessage}
                config={this.props.config}
                onSetInputMode={this.props.onSetInputMode}
                inputMode={this.props.inputMode}
                webchatTheme={this.state.theme}
                onEmitAnalytics={this.props.onEmitAnalytics}
                theme={this.state.theme}
            />
        );
    }

    render() {
        const { props, state } = this;
        const { messages,
            unseenMessages,
            onSendMessage,
            config,
            open,
            fullscreenMessage,
            typingIndicator,
            onEmitAnalytics,
            onSetInputMode,
            onSetFullscreenMessage,
            onDismissFullscreenMessage,
            onClose,
            onToggle,
            webchatRootProps,
            webchatToggleProps,
            connected,
            reconnectionLimit,
            ...restProps
        } = props;
        const { theme, hadConnection, lastUnseenMessageText } = state;

        const { disableToggleButton, enableConnectionStatusIndicator } = config.settings;

        if (!this.props.config.active)
            return null;

        const showDisconnectOverlay = enableConnectionStatusIndicator && !connected && hadConnection;

        return (
            <>
                <ThemeProvider theme={theme}>
                    {/* <Global styles={cssReset} /> */}
                    <>
                        <WebchatWrapper data-cognigy-webchat-root {...restProps} className="webchat-root">
                            <CacheProvider value={styleCache}>
                                {open && (
                                    <WebchatRoot
                                        data-cognigy-webchat
                                        {...webchatRootProps}
                                        className="webchat"
                                    >
                                        {!fullscreenMessage
                                            ? this.renderRegularLayout()
                                            : this.renderFullscreenMessageLayout()
                                        }
                                        {showDisconnectOverlay && <DisconnectOverlay isPermanent={!!reconnectionLimit} onClose={this.props.onClose} />}
                                    </WebchatRoot>
                                )}
                                {!disableToggleButton && (
                                    <div>
                                        {
                                            // Show the message teaser if there is a last bot message and the webchat is closed
                                            lastUnseenMessageText && (
                                                <MessageTeaser
                                                    className="webchat-unread-message-preview"
                                                    onClick={onToggle}
                                                >
                                                    {lastUnseenMessageText}
                                                </MessageTeaser>
                                            )
                                        }

                                        <FAB
                                            data-cognigy-webchat-toggle
                                            onClick={onToggle}
                                            {...webchatToggleProps}
                                            type='button'
                                            className="webchat-toggle-button"
                                        >
                                            {open ? (
                                                <CloseIcon />
                                            ) : (
                                                    <ChatIcon />
                                                )}
                                            {
                                                config.settings.enableUnreadMessageBadge ?
                                                    <Badge
                                                        content={unseenMessages.length}
                                                        backgroundColor={'red'}
                                                        fontColor={theme.primaryContrastColor}
                                                    />
                                                    :
                                                    null
                                            }
                                        </FAB>
                                    </div>
                                )}
                            </CacheProvider>
                        </WebchatWrapper>
                    </>
                </ThemeProvider>
            </>
        )
    }

    renderRegularLayout() {
        const {
            config,
            messages,
            typingIndicator
        } = this.props;

        return (
            <>
                <Header
                    onClose={this.props.onClose}
                    connected={config.active}
                    logoUrl={config.settings.headerLogoUrl}
                    title={config.settings.title || 'Cognigy Webchat'}
                />
                <HistoryWrapper disableBranding={config.settings.disableBranding} ref={this.history as any} className="webchat-chat-history">
                    {this.renderHistory()}
                </HistoryWrapper>
                {this.renderInput()}
            </>
        )
    }

    renderFullscreenMessageLayout() {
        const {
            config,
            fullscreenMessage,
            onDismissFullscreenMessage,
            onEmitAnalytics
        } = this.props;

        const { messagePlugins } = this.state;

        return (
            <FullScreenMessage
                onSendMessage={this.sendMessage}
                config={config}
                plugins={messagePlugins}
                onSetFullscreen={() => { }}
                onDismissFullscreen={onDismissFullscreenMessage}
                message={fullscreenMessage as IMessage}
                webchatTheme={this.state.theme}
                onEmitAnalytics={onEmitAnalytics}
            />
        )
    }

    renderHistory() {
        const { messages, typingIndicator, config, onEmitAnalytics } = this.props;
        const { messagePlugins = [] } = this.state;

        const renderTypingIndicator = typingIndicator !== 'remove';
        const typingIndicatorHidden = typingIndicator === 'hide';

        return (
            <>
                {messages.map((message, index) => (
                    <MessagePluginRenderer
                        key={index}
                        message={message}
                        onSendMessage={this.sendMessage}
                        onSetFullscreen={() => this.props.onSetFullscreenMessage(message)}
                        onDismissFullscreen={() => { }}
                        config={config}
                        plugins={messagePlugins}
                        webchatTheme={this.state.theme}
                        onEmitAnalytics={onEmitAnalytics}
                    />
                ))}
                {renderTypingIndicator && (
                    <MessageRow align='left' hidden={typingIndicatorHidden}>
                        <TypingIndicatorBubble />
                    </MessageRow>
                )}
            </>
        )
    }
}
