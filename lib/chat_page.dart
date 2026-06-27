import 'package:flutter/material.dart';

import 'ad_gate_service.dart';
import 'appwrite_config.dart';
import 'feed_banner_ad.dart';
import 'social_engagement_service.dart';

class ChatPage extends StatefulWidget {
  const ChatPage({
    super.key,
    required this.hasAdFreeAccess,
  });

  final bool hasAdFreeAccess;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _composerController = TextEditingController();
  final _composerFocusNode = FocusNode();
  String? _replyingToMessageId;
  String? _replyingToUserName;
  PickedMatchRecord? _attachedPick;
  bool _sending = false;
  Future<_ChatMeta>? _chatMetaFuture;

  @override
  void initState() {
    super.initState();
    _chatMetaFuture = _loadChatMeta();
  }

  Future<_ChatMeta> _loadChatMeta() async {
    final results = await Future.wait([
      SocialEngagementService.instance.fetchChatLikeCounts(roomId: appwriteChatRoomId),
      SocialEngagementService.instance.fetchMyLikedChatMessageIds(roomId: appwriteChatRoomId),
    ]);

    return _ChatMeta(
      likeCounts: results[0] as Map<String, int>,
      likedMessageIds: results[1] as Set<String>,
    );
  }

  void _reloadChatMeta() {
    setState(() {
      _chatMetaFuture = _loadChatMeta();
    });
  }

  Future<_ChatMeta> _ensureChatMetaFuture() {
    return _chatMetaFuture ??= _loadChatMeta();
  }

  @override
  void dispose() {
    _composerController.dispose();
    _composerFocusNode.dispose();
    super.dispose();
  }

  Future<void> _sendMessage() async {
    if (_sending) {
      return;
    }

    final text = _composerController.text.trim();
    if (text.isEmpty && _attachedPick == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Write a message or attach a pick.')),
      );
      return;
    }

    setState(() {
      _sending = true;
    });

    try {
      final selectionText = _attachedPick?.selection;
      final selectionFixtureApiId = _attachedPick?.prediction.fixtureApiId;
      final messageText = text.isEmpty && _attachedPick != null
          ? _shareTextForPick(_attachedPick!)
          : text;

      await SocialEngagementService.instance.sendChatMessage(
        roomId: appwriteChatRoomId,
        message: messageText,
        parentMessageId: _replyingToMessageId,
        selectionFixtureApiId: selectionFixtureApiId,
        selectionText: selectionText,
      );

      if (!mounted) {
        return;
      }

      _composerController.clear();
      setState(() {
        _replyingToMessageId = null;
        _replyingToUserName = null;
        _attachedPick = null;
      });
      _reloadChatMeta();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message posted.')),
      );
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not post message: $error')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _sending = false;
        });
      }
    }
  }

  Future<void> _replyTo(ChatMessageRecord message) async {
    setState(() {
      _replyingToMessageId = message.id;
      _replyingToUserName = message.userName;
    });
    FocusScope.of(context).requestFocus(_composerFocusNode);
  }

  Future<void> _toggleLike(ChatMessageRecord message) async {
    try {
      await SocialEngagementService.instance.toggleChatLike(
        roomId: appwriteChatRoomId,
        messageId: message.id,
      );
      _reloadChatMeta();
    } catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not update like: $error')),
      );
    }
  }

  Future<void> _attachPick() async {
    final pickedGroups = await SocialEngagementService.instance.fetchPickedMatchesByDate();
    if (!mounted) {
      return;
    }

    if (pickedGroups.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No saved picks yet.')),
      );
      return;
    }

    final pick = await showModalBottomSheet<PickedMatchRecord>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            children: [
              Text(
                'Share a pick',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 10),
              for (final group in pickedGroups) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 12, bottom: 8),
                  child: Text(
                    group.label,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                for (final pick in group.picks)
                  Card(
                    child: ListTile(
                      title: Text(
                        '${pick.prediction.homeTeamName ?? 'Home'} vs ${pick.prediction.awayTeamName ?? 'Away'}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        pick.selection,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: () => Navigator.of(sheetContext).pop(pick),
                    ),
                  ),
              ],
            ],
          ),
        );
      },
    );

    if (pick == null) {
      return;
    }

    if (!widget.hasAdFreeAccess) {
      final unlocked = await AdGateService.instance.showRewardedAd();
      if (!unlocked) {
        if (!mounted) {
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Watch a rewarded ad to share a pick.')),
        );
        return;
      }
    }

    setState(() {
      _attachedPick = pick;
      _composerController.text = _shareTextForPick(pick);
      _composerController.selection = TextSelection.collapsed(
        offset: _composerController.text.length,
      );
    });
    FocusScope.of(context).requestFocus(_composerFocusNode);
  }

  String _shareTextForPick(PickedMatchRecord pick) {
    final matchName = '${pick.prediction.homeTeamName ?? 'Home'} vs ${pick.prediction.awayTeamName ?? 'Away'}';
    return 'My pick: $matchName - ${pick.selection}';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final primaryText = isDark ? Colors.white : const Color(0xFF0F1A2C);
    final secondaryText = isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85);
    final surface = isDark ? const Color(0xFF121B2E) : Colors.white;
    final border = isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2);

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isDark
              ? const [Color(0xFF0A0F1E), Color(0xFF10172A), Color(0xFF17233E)]
              : const [Color(0xFFF5F7FB), Color(0xFFE9EDF5), Color(0xFFDEE5EE)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Chat',
                      style: TextStyle(
                        color: primaryText,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: _attachPick,
                    icon: const Icon(Icons.local_fire_department_outlined),
                    label: const Text('Share pick'),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'General messages, replies, likes, and shared picks.',
                  style: TextStyle(color: secondaryText, fontSize: 13),
                ),
              ),
            ),
            if (!widget.hasAdFreeAccess) const FeedBannerAd(),
            const SizedBox(height: 12),
            Expanded(
              child: FutureBuilder<_ChatMeta>(
                future: _ensureChatMetaFuture(),
                builder: (context, likeSnapshot) {
                  final meta = likeSnapshot.data ?? const _ChatMeta(
                    likeCounts: <String, int>{},
                    likedMessageIds: <String>{},
                  );
                  return StreamBuilder<List<ChatMessageRecord>>(
                    stream: SocialEngagementService.instance.watchChatMessages(roomId: appwriteChatRoomId),
                    builder: (context, snapshot) {
                      final messages = snapshot.data ?? const <ChatMessageRecord>[];
                      final rootMessages = messages
                          .where((message) => message.parentMessageId == null)
                          .toList()
                        ..sort((left, right) {
                          final leftTime = left.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
                          final rightTime = right.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
                          return leftTime.compareTo(rightTime);
                        });

                      final repliesByParent = <String, List<ChatMessageRecord>>{};
                      for (final message in messages) {
                        final parentId = message.parentMessageId;
                        if (parentId == null || parentId.trim().isEmpty) {
                          continue;
                        }
                        repliesByParent.putIfAbsent(parentId, () => <ChatMessageRecord>[]).add(message);
                      }

                      for (final replies in repliesByParent.values) {
                        replies.sort((left, right) {
                          final leftTime = left.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
                          final rightTime = right.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);
                          return leftTime.compareTo(rightTime);
                        });
                      }

                      return RefreshIndicator(
                        onRefresh: () async {
                          _reloadChatMeta();
                        },
                        child: messages.isEmpty
                            ? ListView(
                                physics: const AlwaysScrollableScrollPhysics(),
                                padding: const EdgeInsets.all(20),
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(24),
                                    decoration: BoxDecoration(
                                      color: surface,
                                      border: Border.all(color: border),
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Column(
                                      children: [
                                        Icon(Icons.forum_outlined, size: 40, color: secondaryText),
                                        const SizedBox(height: 12),
                                        Text(
                                          'No messages yet',
                                          style: TextStyle(
                                            color: primaryText,
                                            fontSize: 18,
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          'Start the chat, reply to someone, or share a pick from your saved selections.',
                                          textAlign: TextAlign.center,
                                          style: TextStyle(color: secondaryText, height: 1.4),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              )
                            : ListView.builder(
                                physics: const AlwaysScrollableScrollPhysics(),
                                padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                                itemCount: rootMessages.length,
                                itemBuilder: (context, index) {
                                  final message = rootMessages[index];
                                  final replies = repliesByParent[message.id] ?? const <ChatMessageRecord>[];
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 12),
                                    child: _ChatMessageCard(
                                      key: ValueKey(message.id),
                                      message: message,
                                      likeCount: meta.likeCounts[message.id] ?? 0,
                                      isLiked: meta.likedMessageIds.contains(message.id),
                                      replies: replies,
                                      onLike: () => _toggleLike(message),
                                      onReply: () => _replyTo(message),
                                    ),
                                  );
                                },
                              ),
                      );
                    },
                  );
                },
              ),
            ),
            _ComposerBar(
              controller: _composerController,
              focusNode: _composerFocusNode,
              isSending: _sending,
              attachedPick: _attachedPick,
              replyingToUserName: _replyingToUserName,
              onSend: _sendMessage,
              onClearAttachment: () {
                setState(() {
                  _attachedPick = null;
                });
              },
              onClearReply: () {
                setState(() {
                  _replyingToMessageId = null;
                  _replyingToUserName = null;
                });
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ChatMessageCard extends StatelessWidget {
  const _ChatMessageCard({
    super.key,
    required this.message,
    required this.likeCount,
    required this.isLiked,
    required this.replies,
    required this.onLike,
    required this.onReply,
  });

  final ChatMessageRecord message;
  final int likeCount;
  final bool isLiked;
  final List<ChatMessageRecord> replies;
  final VoidCallback onLike;
  final VoidCallback onReply;

  @override
  Widget build(BuildContext context) {
    return _ChatMessageCardShell(
      message: message,
      likeCount: likeCount,
      isLiked: isLiked,
      replies: replies,
      onLike: onLike,
      onReply: onReply,
    );
  }
}

class _ChatMessageCardShell extends StatefulWidget {
  const _ChatMessageCardShell({
    required this.message,
    required this.likeCount,
    required this.isLiked,
    required this.replies,
    required this.onLike,
    required this.onReply,
  });

  final ChatMessageRecord message;
  final int likeCount;
  final bool isLiked;
  final List<ChatMessageRecord> replies;
  final VoidCallback onLike;
  final VoidCallback onReply;

  @override
  State<_ChatMessageCardShell> createState() => _ChatMessageCardShellState();
}

class _ChatMessageCardShellState extends State<_ChatMessageCardShell> {
  bool _showReplies = false;

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final likeCount = widget.likeCount;
    final isLiked = widget.isLiked;
    final replies = widget.replies;
    final onLike = widget.onLike;
    final onReply = widget.onReply;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF121B2E) : Colors.white;
    final border = isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2);
    final primaryText = isDark ? Colors.white : const Color(0xFF0F1A2C);
    final secondaryText = isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85);

    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: const Color(0xFF00D4AA).withAlpha(28),
                  child: Text(
                    message.userName.isNotEmpty ? message.userName[0].toUpperCase() : '?',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        message.userName,
                        style: TextStyle(
                          color: primaryText,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (message.createdAt != null)
                        Text(
                          _formatChatTime(message.createdAt!),
                          style: TextStyle(color: secondaryText, fontSize: 11),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              message.message,
              style: TextStyle(
                color: primaryText,
                height: 1.4,
              ),
            ),
            if (message.selectionText != null && message.selectionText!.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: const Color(0xFF00D4AA).withAlpha(20),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  message.selectionText!,
                  style: const TextStyle(
                    color: Color(0xFF00D4AA),
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                TextButton.icon(
                  onPressed: onLike,
                  icon: Icon(
                    isLiked ? Icons.favorite : Icons.favorite_border,
                    size: 18,
                  ),
                  label: Text('$likeCount'),
                  style: TextButton.styleFrom(
                    foregroundColor: isLiked ? Colors.redAccent : secondaryText,
                  ),
                ),
                TextButton.icon(
                  onPressed: onReply,
                  icon: const Icon(Icons.reply, size: 18),
                  label: const Text('Reply'),
                ),
                if (replies.isNotEmpty)
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _showReplies = !_showReplies;
                      });
                    },
                    icon: Icon(
                      _showReplies ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                    ),
                    label: Text(_showReplies ? 'Hide replies' : 'Replies (${replies.length})'),
                    style: TextButton.styleFrom(
                      foregroundColor: secondaryText,
                    ),
                  ),
              ],
            ),
            if (_showReplies && replies.isNotEmpty) ...[
              const SizedBox(height: 4),
              Padding(
                padding: const EdgeInsets.only(left: 12),
                child: Container(
                  decoration: BoxDecoration(
                    border: Border(left: BorderSide(color: const Color(0xFF00D4AA).withAlpha(120), width: 2)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.only(left: 12),
                    child: Column(
                      children: [
                        for (final reply in replies) ...[
                          Container(
                            margin: const EdgeInsets.only(top: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFF00D4AA).withAlpha(10),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  reply.userName,
                                  style: TextStyle(
                                    color: primaryText,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  reply.message,
                                  style: TextStyle(color: secondaryText, height: 1.4),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ChatMeta {
  const _ChatMeta({
    required this.likeCounts,
    required this.likedMessageIds,
  });

  final Map<String, int> likeCounts;
  final Set<String> likedMessageIds;
}

class _ComposerBar extends StatelessWidget {
  const _ComposerBar({
    required this.controller,
    required this.focusNode,
    required this.isSending,
    required this.attachedPick,
    required this.replyingToUserName,
    required this.onSend,
    required this.onClearAttachment,
    required this.onClearReply,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isSending;
  final PickedMatchRecord? attachedPick;
  final String? replyingToUserName;
  final VoidCallback onSend;
  final VoidCallback onClearAttachment;
  final VoidCallback onClearReply;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF121B2E) : Colors.white;
    final border = isDark ? const Color(0xFF1E2B4C) : const Color(0xFFE2EAF2);
    final secondaryText = isDark ? const Color(0xFF8C9FB8) : const Color(0xFF5A6E85);

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        decoration: BoxDecoration(
          color: surface,
          border: Border(top: BorderSide(color: border)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (replyingToUserName != null || attachedPick != null) ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (replyingToUserName != null)
                    InputChip(
                      label: Text('Replying to $replyingToUserName'),
                      onDeleted: onClearReply,
                    ),
                  if (attachedPick != null)
                    InputChip(
                      label: Text(attachedPick!.selection),
                      onDeleted: onClearAttachment,
                    ),
                ],
              ),
              const SizedBox(height: 10),
            ],
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: controller,
                    focusNode: focusNode,
                    minLines: 1,
                    maxLines: 4,
                    decoration: InputDecoration(
                      hintText: 'Write a message...',
                      filled: true,
                      fillColor: isDark ? const Color(0xFF0A0F1E) : const Color(0xFFF7F9FC),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton(
                  onPressed: isSending ? null : onSend,
                  child: isSending
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send),
                ),
              ],
            ),

          ],
        ),
      ),
    );
  }
}

String _formatChatTime(DateTime date) {
  final local = date.toLocal();
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '${local.year}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} $hour:$minute';
}
